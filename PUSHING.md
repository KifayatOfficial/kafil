# Pushing to GitHub

The remote is already configured:
```
origin  https://github.com/KifayatOfficial/kafil.git
```

The repo doesn't exist on GitHub yet (verified at scaffold time — `404`). To finish wiring it up:

## 1. Create the empty private repo

Go to https://github.com/new and create `KifayatOfficial/kafil` as **Private**. Do not initialize with a README/license — we already have history to push.

## 2. Authenticate

This sandbox has no GitHub credentials. Pick one path:

### Option A — Personal Access Token (easiest)

1. Generate a fine-grained token at https://github.com/settings/personal-access-tokens/new with:
   - Repository access: `KifayatOfficial/kafil` only
   - Permissions: **Contents → Read and write**
2. From this workspace, run:
   ```bash
   cd ~/.workspace/kafil
   git push -u https://<USERNAME>:<TOKEN>@github.com/KifayatOfficial/kafil.git main
   ```
   Replace `<USERNAME>` with `KifayatOfficial` and `<TOKEN>` with the PAT.
3. Optionally cache credentials for next time:
   ```bash
   git config --global credential.helper "store"
   git push origin main   # will prompt once, then remember
   ```

### Option B — SSH key

1. Generate a key here:
   ```bash
   ssh-keygen -t ed25519 -C "kifayatofficial@gmail.com" -f ~/.ssh/kafil_github -N ""
   cat ~/.ssh/kafil_github.pub
   ```
2. Add the printed public key to https://github.com/settings/keys
3. Point the remote at SSH:
   ```bash
   git -C ~/.workspace/kafil remote set-url origin git@github.com:KifayatOfficial/kafil.git
   ```
4. Add this to `~/.ssh/config`:
   ```
   Host github.com
     User git
     IdentityFile ~/.ssh/kafil_github
     IdentitiesOnly yes
   ```
5. Push:
   ```bash
   git push -u origin main
   ```

## 3. Verify

After push:
```bash
git -C ~/.workspace/kafil status
git -C ~/.workspace/kafil log --oneline
```
