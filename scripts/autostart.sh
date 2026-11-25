#!/bin/sh
# Start PhoneDrop automatically when you log in to the Mac, and restart it if it stops.
#
#   sh scripts/autostart.sh install     turn auto-start on (and start it now)
#   sh scripts/autostart.sh uninstall   turn auto-start off
#   sh scripts/autostart.sh status      show whether it is running
#
# It installs a per-user LaunchAgent. No admin password needed.

set -eu

LABEL="com.phonedrop.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/PhoneDrop.log"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
UID_NUM="$(id -u)"

case "${1:-status}" in
  install)
    NODE="$(command -v node || true)"
    if [ -z "$NODE" ]; then echo "node not found in PATH"; exit 1; fi
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/server.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
    # reload if it was already loaded
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$UID_NUM" "$PLIST"
    echo "Auto-start is ON. PhoneDrop starts at login."
    echo "Node used: $NODE ($(readlink -f "$NODE" 2>/dev/null || echo "$NODE"))"
    echo "Log file:  $LOG"
    ;;
  uninstall)
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Auto-start is OFF."
    ;;
  status)
    if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
      launchctl print "gui/$UID_NUM/$LABEL" | grep -E "state =|pid =|last exit" || true
    else
      echo "Auto-start is not installed."
    fi
    ;;
  *)
    echo "Usage: sh scripts/autostart.sh install|uninstall|status"
    exit 1
    ;;
esac
