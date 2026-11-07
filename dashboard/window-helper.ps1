# live-pulse window helper: places the dashboard window and minimises it.
# Reads one command per line on stdin, answers one JSON line on stdout:
#   place cur|next|prev|win  -> fill the free area of the window's monitor / the next / the previous one,
#                               or (win) a normal window, 3/4 of its monitor, centred
#   rect                     -> the window's rect, its monitor's free area, in front, minimised
#   min                      -> minimise the window
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public static class PulseWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  public delegate bool MonProc(IntPtr m, IntPtr dc, ref RECT r, IntPtr d);

  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonProc p, IntPtr d);

  public static void Init() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4)) == IntPtr.Zero) SetProcessDPIAware(); }
    catch { SetProcessDPIAware(); }
  }

  public static IntPtr Find(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      StringBuilder c = new StringBuilder(256);
      GetClassName(h, c, 256);
      if (c.ToString() != "CASCADIA_HOSTING_WINDOW_CLASS") return true;
      StringBuilder t = new StringBuilder(512);
      GetWindowText(h, t, 512);
      if (t.ToString().Contains(title)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  static List<RECT> Monitors() {
    List<RECT> l = new List<RECT>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr m, IntPtr dc, ref RECT r, IntPtr d) {
      MONITORINFO mi = new MONITORINFO();
      mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      GetMonitorInfo(m, ref mi);
      l.Add(mi.rcWork);
      return true;
    }, IntPtr.Zero);
    l.Sort(delegate (RECT a, RECT b) { return a.L != b.L ? a.L.CompareTo(b.L) : a.T.CompareTo(b.T); });
    return l;
  }

  static RECT MonitorOf(IntPtr h) {
    MONITORINFO mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    GetMonitorInfo(MonitorFromWindow(h, 2), ref mi);
    return mi.rcWork;
  }

  static string R(RECT r) { return "\"x\":" + r.L + ",\"y\":" + r.T + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T); }

  public static string Place(string title, string mode) {
    IntPtr h = Find(title);
    if (h == IntPtr.Zero) return "{\"ok\":false,\"why\":\"window not found\"}";
    List<RECT> mons = Monitors();
    RECT cur = MonitorOf(h);
    int idx = 0;
    for (int i = 0; i < mons.Count; i++) if (mons[i].L == cur.L && mons[i].T == cur.T) idx = i;
    if (mode == "next") idx = (idx + 1) % mons.Count;
    if (mode == "prev") idx = (idx - 1 + mons.Count) % mons.Count;
    RECT m = mons[idx];
    int mw = m.R - m.L, mh = m.B - m.T;
    ShowWindow(h, 9); // restore, so a size applies
    int x = m.L, y = m.T, w = mw, hh = mh;
    if (mode == "win") { w = mw * 3 / 4; hh = mh * 3 / 4; x = m.L + (mw - w) / 2; y = m.T + (mh - hh) / 2; }
    // twice: moving between monitors of different scale resizes the window once on arrival
    SetWindowPos(h, IntPtr.Zero, x, y, w, hh, 0x0004 | 0x0040);
    SetWindowPos(h, IntPtr.Zero, x, y, w, hh, 0x0004 | 0x0040);
    SetForegroundWindow(h);
    return "{\"ok\":true,\"monitor\":" + idx + ",\"monitors\":" + mons.Count + "," + R(m) + "}";
  }

  public static string Min(string title) {
    IntPtr h = Find(title);
    if (h == IntPtr.Zero) return "{\"ok\":false}";
    ShowWindow(h, 6);
    return "{\"ok\":true}";
  }

  public static string Rect(string title) {
    IntPtr h = Find(title);
    if (h == IntPtr.Zero) return "{\"ok\":false}";
    RECT r;
    GetWindowRect(h, out r);
    RECT m = MonitorOf(h);
    List<RECT> mons = Monitors();
    int idx = 0;
    for (int i = 0; i < mons.Count; i++) if (mons[i].L == m.L && mons[i].T == m.T) idx = i;
    return "{\"ok\":true," + R(r) + ",\"mx\":" + m.L + ",\"my\":" + m.T + ",\"mw\":" + (m.R - m.L) + ",\"mh\":" + (m.B - m.T) +
      ",\"monitor\":" + idx + ",\"monitors\":" + mons.Count +
      ",\"front\":" + (GetForegroundWindow() == h ? "true" : "false") + ",\"min\":" + (IsIconic(h) ? "true" : "false") + "}";
  }

}
"@
[PulseWin]::Init()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $a = $line.Trim().Split(' ')
  try {
    switch ($a[0]) {
      'place' { $mode = 'cur'; if ($a.Length -gt 1) { $mode = $a[1] }; $out = [PulseWin]::Place('Live Pulse', $mode) }
      'rect' { $out = [PulseWin]::Rect('Live Pulse') }
      'min' { $out = [PulseWin]::Min('Live Pulse') }
      default { $out = '{"ok":false,"why":"unknown command"}' }
    }
  } catch {
    $out = '{"ok":false,"why":' + (ConvertTo-Json ($_.Exception.Message) -Compress) + '}'
  }
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
}
