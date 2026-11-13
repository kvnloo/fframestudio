#!/usr/bin/env python3
"""JSON-lines adapter; run on the OAuth owner, never ship credentials to its caller.

FFS_Z0LIVE_DESKTOP points at z0live/desktop; FFS_HERMES_SOURCE at the installed
Hermes checkout. HERMES_HOME must identify the clean profile. No refresh/write.
Transport and protocol are imported from z0live, not reimplemented here.
"""
import json
import os
import re
import signal
import sys
import threading
import uuid


def dependencies():
    from pathlib import Path
    home = Path.home() / '.hermes/profiles/clean'
    if Path(os.environ.get('HERMES_HOME', '')).resolve() != home.resolve():
        raise RuntimeError('clean-profile-required')
    sys.path.insert(0, os.environ['FFS_HERMES_SOURCE'])
    sys.path.insert(0, os.environ['FFS_Z0LIVE_DESKTOP'])
    from hermes_cli.auth_codex import resolve_codex_runtime_credentials, _codex_access_token_is_expiring
    from importlib import import_module
    live = import_module('z0live_desktop.live')
    bidi_protocol = import_module('z0live_desktop.bidi_protocol')
    return resolve_codex_runtime_credentials, _codex_access_token_is_expiring, live, bidi_protocol


OUTPUT_LOCK = threading.Lock()


def emit(value):
    with OUTPUT_LOCK:
        print(json.dumps(value, ensure_ascii=False), flush=True)


def access(resolve, expiring, bp):
    result = resolve(read_only=True, refresh_if_expiring=False)
    token = result.get('api_key', '')
    if result.get('base_url', '').rstrip('/') not in {bp.CODEX_BASE_URL, bp.CODEX_BASE_URL + '/codex'}:
        raise RuntimeError('subscription-route-unavailable')
    if not bp.account_id(token) or expiring(token, 60):
        raise RuntimeError('subscription-login-unavailable-or-expiring')
    return token


def main():
    call = None

    def terminate(_signal, _frame):
        raise SystemExit(0)  # finally closes the provider call on SSH/bridge teardown.

    signal.signal(signal.SIGTERM, terminate)
    try:
        resolve, expiring, live, bp = dependencies()
        for line in sys.stdin:
            request = json.loads(line)
            kind = request.get('op')
            if kind == 'probe':
                access(resolve, expiring, bp)
                # Import the connector dependency without opening a provider call.
                from websockets.sync.client import connect  # noqa: F401
                emit({'type': 'capabilities', 'subscriptionAvailable': True,
                      'subscriptionUnexpired': True, 'sidebandAvailable': True})
                continue
            if kind == 'open' and call is None:
                token = access(resolve, expiring, bp)
                scoped, realtime = str(uuid.uuid4()), str(uuid.uuid4())
                answer, call_id = live.signal(request['sdp'], request['instructions'],
                                              'sol', token, scoped, realtime)

                class AppCall(live.LiveCall):
                    # App executes delegation through its existing ACP submitAssistant.
                    # Do not route to z0live's default persistent session or recovery.
                    def receive(self, raw):
                        head = raw[:80].encode() if isinstance(raw, str) else bytes(raw[:80])
                        if any(t in head for t in live.AUDIO_TYPES):
                            return
                        event = bp.parse_event(raw)
                        if event and event['type'] in {'delegation.created', 'turn.done', 'error'}:
                            if event['type'] == 'error':
                                event = {'type': 'error', 'message': 'live-provider-error'}
                            emit({'type': 'event', 'event': event})

                    def run(self):
                        try:
                            for raw in self.ws:
                                if self.closed.is_set():
                                    break
                                self.receive(raw)
                        except Exception:
                            emit({'type': 'event', 'event': {'type': 'error', 'message': 'live-sideband-disconnected'}})
                        finally:
                            self.closed.set()
                            emit({'type': 'event', 'event': {'type': 'closed'}})

                call = AppCall(None, scoped, None, call_id, token, scoped, realtime, None,
                               attempts=2)
                if not call.connect():
                    call.close()
                    raise RuntimeError('live-sideband-unavailable')
                emit({'type': 'opened', 'sdp': answer, 'callId': call_id, 'model': bp.LIVE_MODEL})
                threading.Thread(target=call.run, daemon=True).start()
            elif kind == 'context' and call is not None:
                text = bp.final_message(request['text']) if request.get('final') else request['text']
                delegation_id = request.get('delegationId')
                ok = True
                for part in bp.chunk(text):
                    message = (bp.delegation_append(delegation_id, part, request['channel'])
                               if delegation_id else bp.session_append(part, request['channel']))
                    if not call.send(message):
                        ok = False
                        break
                emit({'type': 'ack', 'id': request['id'], 'ok': ok})
            elif kind == 'end':
                if call is not None:
                    call.close()
                emit({'type': 'ack', 'id': request['id'], 'ok': True})
                break
            else:
                raise RuntimeError('invalid-helper-operation')
    except Exception as exc:
        # No exception strings: auth/network libraries can embed credentials or claims.
        safe = {'clean-profile-required', 'subscription-route-unavailable',
                'subscription-login-unavailable-or-expiring', 'live-sideband-unavailable'}
        message = str(exc) if type(exc) is RuntimeError and str(exc) in safe else 'live-helper-unavailable'
        status = re.fullmatch(r'live signaling HTTP (\d{3})', str(exc))
        if type(exc).__name__ == 'SignalingError':
            message = 'live-signaling-http-' + status[1] if status else 'live-signaling-unavailable'
        emit({'type': 'error', 'error': message})
        return 1
    finally:
        if call is not None:
            call.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
