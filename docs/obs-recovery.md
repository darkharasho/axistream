# Recovering personal OBS settings after an older AxiStream build

Older Windows builds could launch an installed OBS, switch its active profile and scene collection to `AxiStream`, and write capture settings into the normal `%APPDATA%\obs-studio` tree. Recovering scenes and sources does not recover profile-level settings such as canvas/output resolution, encoder settings, or the connected YouTube service.

Do this on the affected computer. AxiStream cannot recover data from a different machine.

1. Close AxiStream and OBS. In Task Manager, confirm no older AxiStream process is still running.
2. Copy the entire `%APPDATA%\obs-studio` directory somewhere safe before changing anything. Keep this untouched backup even if the current files appear incomplete.
3. Start OBS directly. In **Profile**, select the profile you used before AxiStream. In **Scene Collection**, select the matching prior collection. These are separate selections; restoring one does not restore the other.
4. Check **Settings → Video** for Base (Canvas) and Output (Scaled) Resolution, then **Settings → Output** for encoder, bitrate, recording, and audio settings.
5. Check **Settings → Stream**. If the YouTube account is absent, reconnect it in OBS. Do not copy tokens or `service.json` from an untrusted source.

The relevant files in the backup are:

- `global.ini`: the active profile and collection names;
- `basic\profiles\<profile>\basic.ini`: video and output settings;
- `basic\profiles\<profile>\service.json`: streaming service/account configuration;
- `basic\scenes\<collection>.json`: scenes and sources.

If the old profile folder still exists under `basic\profiles`, preserve it and restart OBS before concluding it is gone. If it was overwritten or deleted, use Windows File History, OneDrive version history, a system backup, or the folder's **Restore previous versions** feature. A recovered scene collection alone cannot reconstruct lost profile settings or YouTube authorization.

Current AxiStream builds do not read or write `%APPDATA%\obs-studio`. They extract the pinned Windows OBS runtime under `%LOCALAPPDATA%\AxiStream\obs-runtime`, use a private portable configuration directory there, and stop only the process tree they created. Linux uses the separate Flatpak identity `link.axi.AxiStream.OBS` and its separate data directory.
