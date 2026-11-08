# live-pulse alerts helper: Windows toasts and short sounds for the dashboard.
# Reads one command per line on stdin:
#   toast <base64 of JSON {title, body}>   -> a Windows notification
#   sound <path to a .wav>                 -> plays it
#   clear x                                -> takes the last toast off the screen and the notification centre
$ErrorActionPreference = 'SilentlyContinue'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
$players = @{}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $sp = $line.IndexOf(' ')
  if ($sp -lt 0) { continue }
  $cmd = $line.Substring(0, $sp)
  $arg = $line.Substring($sp + 1)
  try {
    if ($cmd -eq 'toast') {
      $j = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($arg)) | ConvertFrom-Json
      $t = [Security.SecurityElement]::Escape([string]$j.title)
      $b = [Security.SecurityElement]::Escape([string]$j.body)
      $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
      $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text><text placement='attribution'>Live Pulse</text></binding></visual><audio silent='true'/></toast>")
      $n = [Windows.UI.Notifications.ToastNotification]::new($xml)
      $n.Tag = 'live-pulse'
      $n.Group = 'live-pulse'
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($n)
    }
    elseif ($cmd -eq 'clear') {
      [Windows.UI.Notifications.ToastNotificationManager]::History.Remove('live-pulse', 'live-pulse', $app)
    }
    elseif ($cmd -eq 'sound') {
      if (-not $players.ContainsKey($arg)) {
        $p = New-Object System.Media.SoundPlayer $arg
        $p.Load()
        $players[$arg] = $p
      }
      $players[$arg].Play()
    }
  }
  catch { }
}
