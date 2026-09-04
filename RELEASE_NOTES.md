# Release Notes

## Version v1.0.6 — September 3, 2026

You can pick your encoder now, and the app stops claiming an encoder it isn't using.

### Choose which encoder AxiStream streams with
Quality settings had a single "Use software encoding" checkbox: your graphics card, or x264. That is not the choice most people want to make. It is now a proper picker listing every encoder AxiStream can drive — NVIDIA NVENC in H.264, HEVC and AV1, AMD in H.264 and HEVC, Intel/AMD VAAPI on Linux, and x264 software encoding — with **Auto** still the default and still naming what it will actually pick on your machine.

Encoders your setup can't use are still listed, greyed out, and say why: "no NVIDIA GPU detected", "Windows only", "needs enhanced RTMP" for the codecs YouTube's current ingest won't take. That last one matters if you came here for AV1 — the encoder exists, your card may well support it, but the ingest AxiStream streams to does not carry it yet. Showing it disabled with the reason is more honest than pretending the option isn't there.

If you had software encoding ticked, you stay on x264 — the setting carries over.

### AxiStream no longer says "VAAPI" when it is really using x264
On AMD and Intel graphics, the encoder chip could read VAAPI while the stream was actually being encoded in software by your CPU. The hardware path was never reachable — it needs an OBS output mode AxiStream doesn't use — so the label was describing an intention, not what ran. If you have been streaming on an AMD or Intel GPU and wondering why your CPU was working harder than the chip suggested, this is the answer. The chip now reports what is really encoding your stream, and VAAPI is listed as unavailable with that reason.

### Every dropdown looks like the rest of the app
The dropdown lists — camera, resolution, frame rate, audio devices, push-to-talk key, privacy — were drawn by the system rather than by AxiStream, which on Linux meant a bright white list opening over a dark panel. They are AxiStream's own now: same dark palette, same fonts, and they behave properly with the keyboard. Long lists (audio devices, especially) support type-to-jump — start typing a device name and it goes there.

## Version v1.0.5 — September 3, 2026

A Windows packaging fix, for anyone who hit a crash or a failed update.

### The Windows build no longer runs part of itself out of your Temp folder
AxiStream uses a small native component on Windows to read your push-to-talk key and to keep the OBS it starts tied to the app's own lifetime. Because of a packaging oversight, that component was bundled in a form Windows can't load directly, so every launch copied it into your Temp folder and ran it from there.

That is a fragile place to run code from: antivirus tools inspect, quarantine and delete files there, and Temp gets cleaned out on a schedule. One Windows crash report we received named exactly that temp copy as the faulting component. The component now ships in AxiStream's own program folder and is loaded from there.

We can't yet prove this was the cause of that crash — the report doesn't go deep enough to say — but it removes a genuine failure mode, and it is the right way to ship the component regardless.

### If an update failed with "Failed to uninstall old application files"
That message means the installer found AxiStream's files still locked by something and stopped rather than leave a half-replaced install behind. It follows a crash: Windows keeps the crashed program's files held while it collects its error report.

To get unstuck, restart your PC and run the update again. If it still refuses, uninstall AxiStream from Settings → Apps first, then install this version fresh — your settings, YouTube sign-in and masks are kept.

## Version v1.0.4 — September 2, 2026

An audio fix for anyone capturing specific apps.

### Per-app audio no longer leaks your whole desktop
If you picked specific applications to capture — Discord and Guild Wars 2, say — the stream could end up carrying those apps *plus* everything else coming out of your speakers: notifications, music, a video in another window. It started sounding right and went wrong later in the session, which is what made it hard to pin down.

The trigger was anything that rebuilds the capture: changing your capture source, or AxiStream repairing it after the game window went away. OBS reloads its saved setup at that point, and that saved setup always has desktop audio switched on. AxiStream turned it back off when it started up, but not after a rebuild — so the desktop mix quietly came back. Your microphone selection was reset to the system default the same way.

All of that is now reapplied every time the capture is rebuilt. If you have been streaming with app-specific audio, this is worth updating for.

## Version v1.0.3 — August 31, 2026

The disappearing preview is fixed.

### The preview no longer dies when you go live
The report we shipped logging for in 1.0.2 turned out not to be a Windows problem at all — it happens on Linux too, just less often. When you go live, AxiStream briefly stops OBS's virtual camera (which is what feeds the in-app preview) so it can apply your resolution and frame rate, then starts it again. OBS answers the stop request before it has actually finished shutting the camera down, and AxiStream wasn't waiting for that to finish — so the restart landed too early, was refused, and the preview stayed blank for the rest of the session while the stream itself carried on fine. AxiStream now waits for the camera to genuinely release, and retries the restart if it loses the race.

### Your quality settings actually apply now
Same root cause, second casualty. Applying a resolution or frame rate change while the preview is running was being refused by OBS for the same reason, and AxiStream read the settings back afterwards and reported the old values as if they were new — so the change looked like it worked and didn't. If you changed resolution, frame rate or bitrate in a recent session and the stream didn't match, this is why. Worth re-checking your Quality settings after updating.

## Version v1.0.2 — August 31, 2026

Windows fixes, and a way to send us a bug report that we can actually act on.

### Your character and map show up in stream titles on Windows
Title variables like `{{character}}`, `{{class}}` and `{{map}}` read the live game state out of Guild Wars 2 — and on Windows they always came back blank, so `2026-08-31 WvW Raid - {{character}} - {{class}}` went live as `2026-08-31 WvW Raid -  -`. AxiStream now reads that game state on Windows the same way it does on Linux. Guild Wars 2 has to be running and you have to be in a map; on the character-select screen the game publishes nothing to read.

### Titles no longer trail off into dashes
Separately: when a title variable had nothing to fill in — Guild Wars 2 closed when you went live, say — the dashes and pipes around it were left stranded. Those now get cleaned up, so an unresolved variable leaves no trace instead of a row of punctuation. Dashes you typed between real text are untouched.

### Export diagnostics
Settings has an Export diagnostics button. It bundles the app log, OBS's logs, and your encoder and device settings into a single zip you can attach to a bug report, with a Show in folder button so you can find it. Your stream key, YouTube sign-in, and Discord webhook are left out of the bundle.

### Groundwork for the disappearing-preview report
We have a report that the in-app preview goes blank on Windows when you go live, while the stream itself keeps working. This release doesn't fix that — it adds the logging needed to tell the two possible causes apart. If you hit this, go live once, then send us the diagnostics bundle.

## Version v1.0.1 — August 26, 2026

A Windows fix release.

### Capture works on Windows again
Windows installs failed at "Capture setup failed — The packaged AxiStream OBS runtime failed integrity verification". The installer was missing the manifest that records the expected checksum of the bundled OBS runtime, so AxiStream refused to trust its own copy of OBS. The manifest now ships with the runtime and capture starts normally.

### Update checks stopped 404ing
Auto-update was pointed at the wrong release and reported "Cannot find latest.yml". Releases are now explicitly promoted so update checks always resolve to an AxiStream app release.

## Version v1.0.0 — August 25, 2026

AxiStream 1.0. Three clicks from a cold start to live on YouTube, on Windows and Linux. (macOS is not in this release.)

### Setup walks you through it now
A first launch offers a two-minute setup: pick the screen showing your game, connect YouTube, and hear your own microphone played back before anyone else does. It's a banner, not a gate — dismiss it and go live immediately if you already know what you're doing. You can run it again any time from Settings → About.

### About, and where the OBS source lives
Settings has an About panel: the version you're running, and links to the licenses, the privacy policy, and how AxiStream bundles OBS Studio. AxiStream ships its own OBS 32.1.2 build rather than touching yours, and the complete corresponding source for it is attached to every release.
