# AxiStream Privacy Policy

_Last updated: October 5, 2026_

AxiStream ("the app") is a desktop application that helps you go live on YouTube
from your own computer. This policy explains what data the app accesses, how it
is used, and how it is stored.

**In short: AxiStream has no servers and collects no analytics. Your data stays
on your own device. The app's developer never receives it. The app only
downloads a public access list and, if you set up a Discord announce webhook,
looks up that webhook's server on Discord (see "Access check" below).**

## Who we are

AxiStream is an open-source desktop application maintained by the project owner.
Questions about this policy can be sent to **project96@gmail.com**.

## What the app accesses

### YouTube account (via Google OAuth)

If you choose to connect your YouTube account, AxiStream uses Google OAuth 2.0 to
request the `https://www.googleapis.com/auth/youtube.force-ssl` scope. This
permission is used **solely** to operate the live-streaming feature on your
behalf, specifically to:

- read your channel name (to confirm which account is connected);
- create, configure, and start a live broadcast (title, privacy setting);
- bind that broadcast to your stream and end it when you stop streaming.

AxiStream does **not** read, modify, or delete your videos, comments, playlists,
subscriptions, or any other YouTube data beyond what is required to run a live
broadcast you have started.

### Access check

AxiStream checks a public access list when it starts and every few hours, by downloading `https://config.axi.link/v1/manifest`. Access to the Axi apps can be revoked for accounts, guilds or Discord servers that violate the terms of use. The list holds only one-way SHA-256 hashes, and the comparison happens on your device: AxiStream compares the Discord server behind your announce webhook against it and never sends it, or anything else about you, anywhere. If the list can't be reached, AxiStream keeps working. If you believe your access was revoked by mistake, use the contact link on the block screen, or reach the author through https://github.com/darkharasho.

If you have configured a Discord announce webhook, the app sends an
unauthenticated GET request to that webhook URL on discord.com to read the id of
the server it posts into. That id is compared locally with the access list and
is never sent anywhere else. If no webhook is configured, no lookup is made.

### Local app settings

Your stream title template, date format, privacy preference, and session counter
are stored locally on your device so the app remembers them between sessions.

## How your data is stored and transmitted

- **OAuth tokens** (access and refresh tokens) are stored **locally and
  encrypted** on your device using your operating system's secure storage
  (Electron `safeStorage`). They are never sent to the developer or to any
  third party other than Google.
- **Video and audio** you stream are sent directly from your computer to
  **YouTube's** servers over RTMPS. They do not pass through any
  developer-operated server — AxiStream operates none.
- The app makes network requests only to **Google/YouTube APIs** (to manage your
  broadcast), to **YouTube's ingestion servers** (to deliver your stream), to
  **config.axi.link** (to download the public access list, a request that
  carries no information about you), and, only if you configured a Discord
  announce webhook, to **Discord** (to post your announcement and to look up
  the webhook's server id for the access check).

## Data sharing

We do not sell, rent, or share your information with anyone. The third parties
involved are Google/YouTube, only to the extent required to provide the
streaming functionality you initiate, and Discord, only if you configure an
announce webhook. Your use of YouTube is also governed by
[Google's Privacy Policy](https://policies.google.com/privacy).

## Data retention and deletion

Because all data is stored locally, you are in full control of it:

- **Disconnect** your YouTube account in the app's settings to immediately delete
  the stored OAuth tokens from your device.
- **Uninstalling** the app removes all locally stored settings and credentials.
- You may also revoke AxiStream's access at any time from your Google Account at
  [https://myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Google API Services User Data Policy

AxiStream's use and transfer of information received from Google APIs will adhere
to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

## Children's privacy

AxiStream is not directed to children under 13 and does not knowingly collect
information from them.

## Changes to this policy

If this policy changes, the updated version will be published at this same URL
with a revised "Last updated" date.

## Contact

For any questions about this policy or your data, contact **project96@gmail.com**.
