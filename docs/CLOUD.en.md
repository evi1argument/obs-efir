# Cloud access

The VPS exposes HTTPS through Caddy. A reverse SSH tunnel connects the VPS to OBS on Windows. Public ports 8787, 14455, and 4455 must remain closed; only 80/443 and SSH are required.

Cloud access has three checks: website Basic Auth, the separate OBS Remote pairing code, and the OBS WebSocket password through SSH.

Start the tunnel on Windows:

```powershell
ssh -NT -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -R 127.0.0.1:14455:127.0.0.1:4455 obs-tunnel@YOUR_SERVER
```

Replace the SSH account and server address. Keep the process running while using the remote.
