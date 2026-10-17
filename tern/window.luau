--!strict
-- Slow work (bridge PID/health/startup, files and ACP) runs in the Node pane,
-- never in the window VM's 50 ms command budget. No window-start hooks.
local function quote(value: string): string
    return "'" .. string.gsub(value, "'", "'\\''") .. "'"
end

local function launch(cx, args: string)
    local node = tern.getenv("FFS_NODE") or "node"
    local script = tern.plugin.dir .. "/app.mjs"
    local discovery = tern.getenv("FFS_BRIDGE_FILE")
    local prefix = if discovery then "FFS_BRIDGE_FILE=" .. quote(discovery) .. " " else ""
    cx.layout:new_tab({
        cwd = tern.plugin.dir,
        command = prefix .. quote(node) .. " " .. quote(script) .. args,
    })
end

tern.command({
    id = "open-library",
    title = "fframestudio: open library",
    run = function(cx) launch(cx, "") end,
})
tern.command({
    id = "open-project",
    title = "fframestudio: open project",
    run = function(cx) launch(cx, "") end, -- library cards are the project picker
})
tern.command({
    id = "render-queue",
    title = "fframestudio: render queue / status",
    run = function(cx) launch(cx, " --queue") end,
})
