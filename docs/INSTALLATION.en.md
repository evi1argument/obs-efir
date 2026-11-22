# OBS Remote installation

OBS Remote has a Windows application that runs next to OBS Studio and an optional Linux gateway for access outside the home network.

## Windows

```powershell
git clone https://github.com/evi1argument/obs-efir.git
cd obs-efir
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Enable OBS WebSocket authentication, choose `start`, then open `http://127.0.0.1:8787/pair`. Connect the phone to the same Wi-Fi network.

## Linux VPS

```bash
git clone https://github.com/evi1argument/obs-efir.git
cd obs-efir
sudo bash install.sh cloud
```

The installer asks for the domain, website credentials, and OBS WebSocket password. Keep the SSH tunnel open from the Windows computer running OBS. See [CLOUD.en.md](./CLOUD.en.md).
