// Sound Atlas in GPUI: radial atlas (feel wedges, tempo = radius) beside a virtualized,
// type-to-filter list, with a rodio player bar. Reads the same catalog.json the web app ships.
use gpui::{
    App, Application, Bounds, Context, FocusHandle, Hsla, KeyDownEvent, MouseButton, MouseDownEvent,
    PathBuilder, Pixels, Point, Render, SharedString, Window, WindowBounds, WindowOptions, canvas,
    div, point, prelude::*, px, rgb, size, uniform_list,
};
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink};
use serde::Deserialize;
use gpui::{ScrollStrategy, UniformListScrollHandle};
use std::{f32::consts::TAU, io::Cursor, sync::mpsc, time::{Duration, Instant}};
macro_rules! bench { ($($a:tt)*) => {{ use std::io::Write; println!($($a)*); std::io::stdout().flush().ok(); }} }

fn base() -> String { std::env::var("SA_BASE").unwrap_or("https://glide-music-picker.vercel.app/".into()) }
// Same order and night colours as web/src/music-atlas/taxonomy.js FEELS.
const FEELS: [(&str, &str, u32); 8] = [
    ("drive", "Fired up", 0xff6b5f), ("lift", "Joyful", 0xffbf4d), ("play", "Playful", 0xff86b8),
    ("groove", "Confident", 0x6ea8ff), ("calm", "At peace", 0x4fd69a), ("wonder", "Dreamy", 0xc38bff),
    ("sad", "Sad", 0x9aa8cc), ("shadow", "Tense", 0x5fd3dc),
];

#[derive(Deserialize)]
struct Catalog { tracks: Vec<Track> }
#[derive(Deserialize, Clone)]
struct Track {
    id: String, title: String, #[serde(default)] author: String, #[serde(default)] audio: String,
    #[serde(default)] feel: String, bpm: Option<f32>, dur: Option<f32>, #[serde(default)] license: String,
    #[serde(skip)] fi: usize, #[serde(skip)] pos: (f32, f32),
}

fn feel_ix(f: &str) -> usize { FEELS.iter().position(|x| x.0 == f).unwrap_or(7) }
fn col(i: usize) -> Hsla { rgb(FEELS[i].2).into() }
fn mmss(s: f32) -> String { format!("{}:{:02}", (s / 60.0) as u32, (s % 60.0) as u32) }

struct Atlas {
    all: Vec<Track>, hits: Vec<usize>, q: String, sel: Option<usize>, playing: Option<usize>,
    focus: FocusHandle, _stream: Option<OutputStream>, handle: Option<OutputStreamHandle>,
    sink: Option<Sink>, loading: bool, status: SharedString,
    scroll: UniformListScrollHandle, t0: Instant, ready: bool, mark: Option<(String, Instant)>,
    bscroll: Option<(usize, Vec<Instant>)>, click: Option<Instant>,
}

impl Atlas {
    fn new(mut all: Vec<Track>, t0: Instant, cx: &mut Context<Self>) -> Self {
        // Place every dot once: angle inside its feel's wedge (stable by id hash), radius by tempo.
        for t in &mut all {
            t.fi = feel_ix(&t.feel);
            let h = t.id.bytes().fold(2166136261u32, |a, b| (a ^ b as u32).wrapping_mul(16777619));
            let a = (t.fi as f32 + 0.08 + 0.84 * (h % 1000) as f32 / 1000.0) / 8.0 * TAU;
            let r = 0.25 + 0.7 * ((t.bpm.unwrap_or(100.0) - 60.0) / 120.0).clamp(0.0, 1.0);
            t.pos = (a, r);
        }
        let (stream, handle) = OutputStream::try_default().map(|(s, h)| (Some(s), Some(h))).unwrap_or((None, None));
        let n = all.len();
        // Tick the progress readout while something plays.
        cx.spawn(async move |this, cx| loop {
            cx.background_executor().timer(Duration::from_millis(250)).await;
            if this.update(cx, |a, cx| if a.sink.is_some() { cx.notify() }).is_err() { break; }
        }).detach();
        // SA_SELFTEST=<query>: filter, play the first hit, log playback progress, quit. No input injection needed.
        if let Ok(q) = std::env::var("SA_SELFTEST") {
            cx.spawn(async move |this, cx| {
                cx.background_executor().timer(Duration::from_secs(1)).await;
                this.update(cx, |a, cx| { a.q = q; a.refilter(); eprintln!("selftest: {} hits", a.hits.len()); if let Some(&i) = a.hits.first() { a.play(i, cx) } }).ok();
                for _ in 0..16 { cx.background_executor().timer(Duration::from_millis(500)).await;
                    this.update(cx, |a, _| eprintln!("selftest: playing={:?} loading={} pos={:.2}s status={:?}", a.playing.map(|i| a.all[i].title.clone()), a.loading, a.sink.as_ref().map(|s| s.get_pos().as_secs_f32()).unwrap_or(0.0), a.status)).ok(); }
                cx.update(|cx| cx.quit()).ok();
            }).detach();
        }
        // SA_BENCH=1: the same phases the web harness runs, printed as BENCH lines the harness timestamps.
        if std::env::var("SA_BENCH").is_ok() {
            cx.spawn(async move |this, cx| {
                let ex = cx.background_executor().clone();
                let wait = |ms| ex.timer(Duration::from_millis(ms));
                wait(300).await; bench!("BENCH idle_start"); wait(5000).await; bench!("BENCH idle_end");
                bench!("BENCH filter_start");
                for q in ["calm", "night", "zzz", "a", ""] {
                    this.update(cx, |a, cx| { a.q = q.into(); a.refilter(); a.mark = Some((q.into(), Instant::now())); cx.notify() }).ok();
                    wait(600).await;
                }
                bench!("BENCH filter_end"); bench!("BENCH scroll_start");
                this.update(cx, |a, cx| { a.bscroll = Some((0, vec![])); cx.notify() }).ok();
                loop { wait(100).await; if this.update(cx, |a, _| a.bscroll.is_none()).unwrap_or(true) { break } }
                bench!("BENCH scroll_end");
                this.update(cx, |a, cx| { if let Some(i) = a.all.iter().position(|t| t.id == "sl-rise-full") { a.click = Some(Instant::now()); a.play(i, cx) } }).ok();
                loop { wait(20).await; if this.update(cx, |a, _| a.sink.as_ref().map_or(false, |s| s.get_pos() > Duration::ZERO)).unwrap_or(true) { break } }
                bench!("BENCH play_start"); wait(10000).await; bench!("BENCH play_end");
                cx.update(|cx| cx.quit()).ok();
            }).detach();
        }
        Self { scroll: UniformListScrollHandle::new(), t0, ready: false, mark: None, bscroll: None, click: None,
            all, hits: (0..n).collect(), q: String::new(), sel: None, playing: None, focus: cx.focus_handle(),
            _stream: stream, handle, sink: None, loading: false, status: format!("{n} tracks · type to search").into() }
    }

    fn refilter(&mut self) {
        let q = self.q.to_lowercase();
        self.hits = (0..self.all.len()).filter(|&i| { let t = &self.all[i];
            q.is_empty() || t.title.to_lowercase().contains(&q) || t.author.to_lowercase().contains(&q) || FEELS[t.fi].1.to_lowercase().contains(&q) }).collect();
    }

    fn play(&mut self, i: usize, cx: &mut Context<Self>) {
        self.sel = Some(i); self.playing = Some(i); self.loading = true;
        if let Some(s) = self.sink.take() { s.stop(); }
        let t = &self.all[i];
        let url = if t.audio.starts_with("http") { t.audio.clone() } else { format!("{}{}", base(), t.audio) };
        self.status = format!("loading {}", t.title).into();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let r = ureq::get(&url).call().map_err(|e| e.to_string()).and_then(|r| {
                let mut b = Vec::new(); std::io::Read::read_to_end(&mut r.into_reader(), &mut b).map_err(|e| e.to_string())?; Ok(b) });
            let _ = tx.send(r);
        });
        cx.spawn(async move |this, cx| {
            let bytes = loop {
                if let Ok(r) = rx.try_recv() { break r; }
                cx.background_executor().timer(Duration::from_millis(50)).await;
            };
            this.update(cx, |a, cx| {
                if a.playing != Some(i) { return; }
                a.loading = false;
                let res = bytes.and_then(|b| { let h = a.handle.as_ref().ok_or("no audio device")?;
                    let s = Sink::try_new(h).map_err(|e| e.to_string())?;
                    s.append(Decoder::new(Cursor::new(b)).map_err(|e| e.to_string())?); Ok(s) });
                match res { Ok(s) => { if let Some(c) = a.click.take() { bench!("BENCH audio_ms {:.1}", c.elapsed().as_secs_f64() * 1e3) } a.sink = Some(s); a.status = "".into(); } Err(e) => a.status = format!("can't play: {e}").into() }
                cx.notify();
            }).ok();
        }).detach();
        cx.notify();
    }

    fn toggle(&mut self, cx: &mut Context<Self>) {
        match (&self.sink, self.sel) {
            (Some(s), _) if self.sel == self.playing => if s.is_paused() { s.play() } else { s.pause() },
            (_, Some(i)) => return self.play(i, cx),
            _ => {}
        }
        cx.notify();
    }

    fn step(&mut self, d: isize, cx: &mut Context<Self>) {
        if self.hits.is_empty() { return; }
        let cur = self.sel.and_then(|s| self.hits.iter().position(|&h| h == s)).map(|p| p as isize).unwrap_or(-1);
        let n = (cur + d).rem_euclid(self.hits.len() as isize) as usize;
        self.sel = Some(self.hits[n]); cx.notify();
    }

    fn key(&mut self, e: &KeyDownEvent, cx: &mut Context<Self>) {
        let k = &e.keystroke;
        match k.key.as_str() {
            "down" => self.step(1, cx), "up" => self.step(-1, cx),
            "enter" => if let Some(i) = self.sel { self.play(i, cx) },
            "space" if self.q.is_empty() => self.toggle(cx),
            "right" => { self.step(1, cx); if let Some(i) = self.sel { self.play(i, cx) } }
            "left" => { self.step(-1, cx); if let Some(i) = self.sel { self.play(i, cx) } }
            "backspace" => { self.q.pop(); self.refilter(); cx.notify() }
            "escape" => { self.q.clear(); self.refilter(); cx.notify() }
            _ => if let Some(c) = k.key_char.as_ref().filter(|_| !k.modifiers.control && !k.modifiers.platform) {
                self.q.push_str(c); self.refilter(); cx.notify();
            },
        }
    }

    fn atlas(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let dots: Vec<(f32, f32, usize, bool)> = { let hit: std::collections::HashSet<_> = self.hits.iter().collect();
            self.all.iter().enumerate().map(|(i, t)| (t.pos.0, t.pos.1, t.fi, hit.contains(&i))).collect() };
        let (sel, playing) = (self.sel, self.playing);
        let ent = cx.entity();
        div().relative().flex_1().h_full().child(canvas(|b, _, _| b, move |b: Bounds<Pixels>, _, window, _| {
            let c = b.center(); let rad = f32::from(b.size.width.min(b.size.height)) * 0.46;
            let at = |a: f32, r: f32| point(c.x + px(a.cos() * r * rad), c.y + px(a.sin() * r * rad));
            for (fi, _) in FEELS.iter().enumerate() { // wedge backdrop
                let (a0, a1) = (fi as f32 / 8.0 * TAU, (fi + 1) as f32 / 8.0 * TAU);
                let mut p = PathBuilder::fill(); p.move_to(at(a0, 0.18));
                for s in 0..=16 { let a = a0 + (a1 - a0) * s as f32 / 16.0; p.line_to(at(a, 1.0)); }
                for s in (0..=16).rev() { let a = a0 + (a1 - a0) * s as f32 / 16.0; p.line_to(at(a, 0.18)); }
                p.close(); if let Ok(path) = p.build() { window.paint_path(path, col(fi).opacity(0.07)); }
            }
            for (i, &(a, r, fi, on)) in dots.iter().enumerate() {
                let big = Some(i) == sel || Some(i) == playing; let s = if big { 9.0 } else { 3.2 };
                let p = at(a, r);
                window.paint_quad(gpui::fill(Bounds::new(point(p.x - px(s / 2.), p.y - px(s / 2.)), size(px(s), px(s))), col(fi).opacity(if on { 0.9 } else { 0.12 })).corner_radii(px(s / 2.)));
            }
        }).size_full())
        .on_mouse_down(MouseButton::Left, move |e: &MouseDownEvent, window, app| {
            let b = window.bounds(); let _ = b; // hit-test in window coords against the atlas pane (left 60%)
            ent.update(app, |a, cx| a.pick(e.position, window, cx));
        })
    }

    fn pick(&mut self, p: Point<Pixels>, window: &Window, cx: &mut Context<Self>) {
        let vs = window.viewport_size(); let (w, h) = (f32::from(vs.width) * 0.58, f32::from(vs.height) - 64.0);
        let rad = w.min(h) * 0.46; let (cx0, cy0) = (w / 2.0, h / 2.0);
        let best = self.hits.iter().map(|&i| { let t = &self.all[i];
            let (x, y) = (cx0 + t.pos.0.cos() * t.pos.1 * rad, cy0 + t.pos.0.sin() * t.pos.1 * rad);
            ((x - f32::from(p.x)).powi(2) + (y - f32::from(p.y)).powi(2), i) }).min_by(|a, b| a.0.total_cmp(&b.0));
        if let Some((d2, i)) = best { if d2 < 144.0 { self.play(i, cx) } }
    }
}

impl Render for Atlas {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.focus.is_focused(window) { window.focus(&self.focus); }
        if !self.ready { self.ready = true; let t0 = self.t0; window.on_next_frame(move |_, _| bench!("BENCH ready_ms {:.1}", t0.elapsed().as_secs_f64() * 1e3)); }
        if let Some((q, t)) = self.mark.take() { window.on_next_frame(move |_, _| bench!("BENCH filter_ms {q:?} {:.2}", t.elapsed().as_secs_f64() * 1e3)); }
        if let Some((k, ts)) = &mut self.bscroll {
            ts.push(Instant::now());
            if *k < 240 { *k += 1; self.scroll.scroll_to_item(*k, ScrollStrategy::Top); window.request_animation_frame(); }
            else { let mut d: Vec<f64> = ts.windows(2).map(|w| (w[1] - w[0]).as_secs_f64() * 1e3).collect(); d.sort_by(f64::total_cmp);
                bench!("BENCH scroll_frames {} p50 {:.2} p95 {:.2} max {:.2}", d.len(), d[d.len() / 2], d[d.len() * 95 / 100], d[d.len() - 1]); self.bscroll = None; }
        }
        let n = self.hits.len();
        let list = uniform_list("tracks", n, cx.processor(|a: &mut Atlas, range: std::ops::Range<usize>, _, cx| {
            range.map(|r| { let i = a.hits[r]; let t = &a.all[i]; let on = a.sel == Some(i);
                div().id(i).flex().items_center().gap_3().px_3().h(px(44.)).cursor_pointer()
                    .bg(if on { rgb(0x23262e) } else { rgb(0x111318) })
                    .child(div().w(px(4.)).h(px(28.)).rounded_sm().bg(col(t.fi)))
                    .child(div().flex().flex_col().flex_1().overflow_hidden()
                        .child(div().text_color(rgb(0xf2efe8)).text_sm().child(t.title.clone()))
                        .child(div().text_color(rgb(0x8f8a80)).text_xs().child(format!("{} · {} · {} bpm", t.author, FEELS[t.fi].1, t.bpm.map(|b| b as u32).unwrap_or(0)))))
                    .child(div().text_color(rgb(0x8f8a80)).text_xs().child(t.dur.map(mmss).unwrap_or_default()))
                    .on_click(cx.listener(move |a, _, _, cx| a.play(i, cx)))
            }).collect()
        })).track_scroll(self.scroll.clone()).flex_1();
        let now = self.playing.map(|i| &self.all[i]);
        let (pos, paused) = self.sink.as_ref().map(|s| (s.get_pos().as_secs_f32(), s.is_paused())).unwrap_or((0.0, true));
        let dur = now.and_then(|t| t.dur).unwrap_or(1.0);
        let player = div().h(px(64.)).flex().items_center().gap_4().px_4().bg(rgb(0x0b0c10)).border_t_1().border_color(rgb(0x23262e))
            .child(div().id("pp").w(px(36.)).h(px(36.)).rounded_full().flex().items_center().justify_center().cursor_pointer()
                .bg(now.map(|t| col(t.fi)).unwrap_or(rgb(0x444444).into())).text_color(rgb(0x0b0c10))
                .child(if self.loading { "…" } else if paused { "▶" } else { "❚❚" }).on_click(cx.listener(|a, _, _, cx| a.toggle(cx))))
            .child(div().flex().flex_col().flex_1()
                .child(div().text_color(rgb(0xf2efe8)).child(now.map(|t| t.title.clone()).unwrap_or("Nothing playing".into())))
                .child(div().text_color(rgb(0x8f8a80)).text_xs().child(now.map(|t| format!("{} · {}", t.author, t.license)).unwrap_or_default()))
                .child(div().mt_1().h(px(3.)).w_full().bg(rgb(0x23262e)).child(div().h_full().w(gpui::relative((pos / dur).clamp(0.0, 1.0)))
                    .bg(now.map(|t| col(t.fi)).unwrap_or(rgb(0x444444).into())))))
            .child(div().text_color(rgb(0x8f8a80)).text_xs().child(if now.is_some() { format!("{} / {}", mmss(pos), mmss(dur)) } else { "–:–– / –:––".into() }));
        div().track_focus(&self.focus).on_key_down(cx.listener(|a, e, _, cx| a.key(e, cx)))
            .size_full().flex().flex_col().bg(rgb(0x111318)).font_family("Inter")
            .child(div().flex().flex_1().overflow_hidden()
                .child(div().w(gpui::relative(0.58)).h_full().child(self.atlas(cx)))
                .child(div().flex_1().h_full().flex().flex_col().border_l_1().border_color(rgb(0x23262e))
                    .child(div().px_3().py_2().text_color(rgb(0xf2efe8)).bg(rgb(0x181a20))
                        .child(if self.q.is_empty() { format!("⌕  search {} tracks", self.all.len()) } else { format!("⌕  {}▏  {} hits", self.q, n) }))
                    .child(div().px_3().py_1().text_xs().text_color(rgb(0xe0a050)).child(self.status.clone()))
                    .child(list)))
            .child(player)
    }
}

fn main() {
    let t0 = Instant::now();
    let path = std::env::args().nth(1).unwrap_or("catalog.json".into());
    let cat: Catalog = serde_json::from_slice(&std::fs::read(&path).expect("catalog.json")).expect("parse catalog");
    Application::new().run(move |cx: &mut App| {
        let b = Bounds::centered(None, size(px(1280.), px(800.)), cx);
        cx.open_window(WindowOptions { window_bounds: Some(WindowBounds::Windowed(b)), ..Default::default() },
            |_, cx| cx.new(|cx| Atlas::new(cat.tracks, t0, cx))).unwrap();
        cx.activate(true);
    });
}
