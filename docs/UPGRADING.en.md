# Upgrade and removal

On a server checkout:

```bash
sudo bash update.sh cloud
```

The command fast-forward updates the checkout and rebuilds the containers. It keeps `.env`. To stop containers while keeping configuration:

```bash
sudo bash uninstall.sh cloud
```
