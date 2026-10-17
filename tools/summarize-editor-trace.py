#!/usr/bin/env python3
"""Summarize an FFS_PERF_TRACE receipt without changing benchmark results."""
import gzip
import json
import pathlib
import sys


def summarize(directory):
    directory = pathlib.Path(directory)
    data = json.loads((directory / 'perf.json').read_text())
    events = json.loads(gzip.decompress((directory / 'trace.json.gz').read_bytes()))['traceEvents']
    first = next(event for event in events if event['name'] == 'rpc:1')
    offset = first['ts'] - first['args']['data']['startTime'] * 1000
    layouts = [event for event in events if event['name'] == 'Layout' and 'dur' in event
               and event['pid'] == first['pid'] and event['tid'] == first['tid']
               and event['ts'] > first['ts']]
    methods = {}
    for name in ['measure', 'refresh', 'renderStory', 'renderTimeline', 'rpc']:
        measures = [item for item in data['measures'] if item['name'] == name]
        spans = [(offset + item['start'] * 1000, offset + (item['start'] + item['ms']) * 1000)
                 for item in measures]
        forced = [event for event in layouts if any(
            start <= event['ts'] and event['ts'] + event['dur'] <= end + 10
            for start, end in spans)]
        methods[name] = {'calls': len(measures), 'totalMs': sum(item['ms'] for item in measures),
                         'maxMs': max((item['ms'] for item in measures), default=0),
                         'layoutsInside': len(forced), 'layoutMs': sum(event['dur'] for event in forced) / 1000}
    schedules = {event['args']['data']['traceId']: event for event in events
                 if event['name'] == 'SchedulePostMessage' and event['ph'] == 'I'}
    workers = {event['tid'] for event in events if event['name'] == 'FunctionCall'
               and event.get('args', {}).get('data', {}).get('url', '').endswith('/doc/worker.js')}
    delays = []
    for event in events:
        if event['name'] != 'HandlePostMessage' or event['tid'] not in workers or event['ts'] < first['ts']:
            continue
        schedule = schedules.get(event['args']['data']['traceId'])
        if schedule:
            delays.append({'startMs': (schedule['ts'] - offset) / 1000,
                           'queueMs': (event['ts'] - schedule['ts']) / 1000,
                           'handlerWallMs': event['dur'] / 1000,
                           'handlerCpuMs': event.get('tdur', 0) / 1000})
    intervals = data['frameIntervals']
    return {'directory': str(directory), 'coldOpenMs': data['coldOpenMs'],
            'cmdWorstMs': max(item['ready'] for item in data['latencies']),
            'nextFrameWorstMs': max(item['present'] for item in data['latencies']),
            'scrubFps': 1000 / (sum(intervals) / len(intervals)), 'methods': methods,
            'workerQueueWorst': sorted(delays, key=lambda item: item['queueMs'], reverse=True)[:5]}


if __name__ == '__main__':
    print(json.dumps([summarize(directory) for directory in sys.argv[1:]], indent=2))
