"""Resolve studio-spec track IDs against the source's music catalogue, read-only."""
import json
import pathlib
import shutil


def resolve_music(base, music, project_dir, studio=None):
    """Copy the selected real audio into the library and retain its detected beat grid.

    buildSpec deliberately exports credits/ID, not the playable file or analysis.
    Catalogue paths are relative to the studio page (or root for root-level studios).
    Never guess a different track when the ID/file is absent.
    """
    base, project_dir = pathlib.Path(base), pathlib.Path(project_dir)
    result = dict(music or {})
    catalogue = base / "music" / "tracks.json"
    if not catalogue.is_file():
        return result
    tracks = json.loads(catalogue.read_text())
    track = next((t for t in tracks if t.get("id") == result.get("id")), None)
    if not track:
        return result
    relative = track.get("full") or track.get("file")
    if not relative:
        return result
    page_dir = (base / studio).parent if studio else base
    source = (page_dir / relative).resolve()
    if not source.is_relative_to(base.resolve()) or not source.is_file():
        return result
    target = project_dir / "media" / ("soundtrack" + source.suffix.lower())
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    result["file"] = target.relative_to(project_dir).as_posix()
    result["beats"] = list(track.get("beats", []))
    return result
