# live-pulse window helper: places the dashboard window on a monitor and finds
# what the taskbar draws over its top rows.
# Reads one command per line on stdin, answers one JSON line on stdout:
#   place cur|next|prev|win  -> cover the window's monitor / the next / the previous one,
#                               or (win) a normal window, 3/4 of its monitor, centred
#   cal <cols> <rows> <band> -> screenshot of the window's monitor; finds the 3 calibration
#                               markers and, in the top <band> rows, every cell that is not
#                               the calibration colour
#   rect                     -> the window's rect, its monitor's work area, in front, minimised
#   min                      -> minimise the window
#   sig                      -> a signature of the taskbar's layout
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
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

  static bool Mag(byte r, byte g, byte b) { return r > 170 && g < 110 && b > 170; }

  public static string Calibrate(string title, int cols, int rows, int band) {
    IntPtr hw = Find(title);
    if (hw == IntPtr.Zero) return "{\"ok\":false,\"why\":\"window not found\"}";
    RECT mon = MonitorOf(hw);
    int W = mon.R - mon.L, H = mon.B - mon.T;
    byte[] px;
    int stride;
    using (Bitmap bmp = new Bitmap(W, H, PixelFormat.Format32bppArgb)) {
      using (Graphics g = Graphics.FromImage(bmp)) g.CopyFromScreen(mon.L, mon.T, 0, 0, new Size(W, H));
      BitmapData d = bmp.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      stride = d.Stride;
      px = new byte[stride * H];
      Marshal.Copy(d.Scan0, px, 0, px.Length);
      bmp.UnlockBits(d);
    }
    Func<int, int, bool> m = delegate (int x, int y) { int i = y * stride + x * 4; return Mag(px[i + 2], px[i + 1], px[i]); };

    // Markers in the lower half: A (col 1, row rows-2) and C (col 1, row rows-5) left, B (col cols-2, row rows-2) right.
    int half = W / 2;
    List<int> leftRows = new List<int>();
    int[] leftMinX = new int[H];
    int bTop = -1, bLeft = int.MaxValue;
    for (int y = H / 2; y < H; y++) {
      leftMinX[y] = int.MaxValue;
      for (int x = 0; x < W; x++) {
        if (!m(x, y)) continue;
        if (x < half) { if (leftMinX[y] == int.MaxValue) leftRows.Add(y); if (x < leftMinX[y]) leftMinX[y] = x; }
        else { if (bTop < 0) bTop = y; if (x < bLeft) bLeft = x; }
      }
    }
    if (leftRows.Count == 0 || bTop < 0) return "{\"ok\":false,\"why\":\"markers not found\"}";
    List<int[]> runs = new List<int[]>();
    int start = leftRows[0], prev = leftRows[0];
    for (int k = 1; k < leftRows.Count; k++) {
      if (leftRows[k] != prev + 1) { runs.Add(new int[] { start, prev }); start = leftRows[k]; }
      prev = leftRows[k];
    }
    runs.Add(new int[] { start, prev });
    if (runs.Count < 2) return "{\"ok\":false,\"why\":\"marker C not found\"}";
    int cTop = runs[0][0], aTop = runs[runs.Count - 1][0];
    int aLeft = int.MaxValue;
    for (int y = runs[runs.Count - 1][0]; y <= runs[runs.Count - 1][1]; y++) if (leftMinX[y] < aLeft) aLeft = leftMinX[y];
    double cellH = (aTop - cTop) / 3.0;
    double cellW = (bLeft - aLeft) / (double)(cols - 3);
    if (cellH < 4 || cellW < 3) return "{\"ok\":false,\"why\":\"cell size\"}";
    double ox = aLeft - cellW;
    double oy = aTop - (rows - 2) * cellH;

    System.Globalization.CultureInfo inv = System.Globalization.CultureInfo.InvariantCulture;
    StringBuilder sb = new StringBuilder();
    sb.Append("{\"ok\":true,\"cellW\":" + cellW.ToString("0.###", inv) + ",\"cellH\":" + cellH.ToString("0.###", inv));
    sb.Append(",\"ox\":" + Math.Round(ox) + ",\"oy\":" + Math.Round(oy) + ",\"rows\":[");
    for (int r = 0; r < band; r++) {
      if (r > 0) sb.Append(",");
      sb.Append("\"");
      for (int c = 0; c < cols; c++) {
        int miss = 0, seen = 0;
        for (int sy = 1; sy <= 3; sy++)
          for (int sx = 1; sx <= 3; sx++) {
            int x = (int)(ox + (c + sx / 4.0) * cellW);
            int y = (int)(oy + (r + sy / 4.0) * cellH);
            seen++;
            if (x < 0 || y < 0 || x >= W || y >= H || !m(x, y)) miss++;
          }
        sb.Append(miss * 3 >= seen ? '1' : '0');
      }
      sb.Append("\"");
    }
    sb.Append("]}");
    return sb.ToString();
  }
}
"@
[PulseWin]::Init()

function Signature {
  try {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $parts = @()
    foreach ($cls in @('Shell_TrayWnd', 'Shell_SecondaryTrayWnd')) {
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, $cls)
      foreach ($tb in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
        foreach ($e in $tb.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
          $r = $e.Current.BoundingRectangle
          if ($r.Width -gt 0 -and $e.Current.ClassName -notlike '*AnimatedVisual*') { $parts += ('{0}:{1}:{2}' -f $e.Current.ClassName, [int]$r.X, [int]$r.Width) }
        }
      }
    }
    return ($parts -join '|')
  } catch { return 'error' }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $a = $line.Trim().Split(' ')
  try {
    switch ($a[0]) {
      'place' { $mode = 'cur'; if ($a.Length -gt 1) { $mode = $a[1] }; $out = [PulseWin]::Place('Live Pulse', $mode) }
      'cal' { $out = [PulseWin]::Calibrate('Live Pulse', [int]$a[1], [int]$a[2], [int]$a[3]) }
      'rect' { $out = [PulseWin]::Rect('Live Pulse') }
      'min' { $out = [PulseWin]::Min('Live Pulse') }
      'sig' { $s = Signature; $out = '{"sig":' + (ConvertTo-Json $s -Compress) + '}' }
      default { $out = '{"ok":false,"why":"unknown command"}' }
    }
  } catch {
    $out = '{"ok":false,"why":' + (ConvertTo-Json ($_.Exception.Message) -Compress) + '}'
  }
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
}
