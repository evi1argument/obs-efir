# Troubleshooting

Run the Windows diagnostic command:

```powershell
powershell -ExecutionPolicy Bypass -File .\obs-remote.ps1 doctor
```

For cloud access, check DNS, ports 80/443, the SSH tunnel, the OBS WebSocket port, and the password in the server `.env`. Do not expose OBS port 4455 to the internet.
