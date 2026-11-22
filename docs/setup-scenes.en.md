# Setting up OBS Remote

OBS Remote does not create its own visual theme or require a special scene collection. It connects to a running OBS Studio instance and shows scenes in the current collection, sources, layer order, visibility, and mute state.

The remote's interface is currently in Russian; its button labels are given below in parentheses.

## 1. Prepare OBS Studio

1. Install OBS Studio 30 or later.
2. Open **Tools → WebSocket Server Settings**.
3. Enable the WebSocket server and authentication.
4. Set a password and save the settings.
5. Create the profile and scene collection you want to use for streaming.

In local mode, the remote reads the WebSocket settings on the same computer. In server mode, the password is configured separately.

## 2. Build your scenes

Scene names can be anything. Clear roles make them easier to recognize on a phone:

| Role | Typical contents |
| --- | --- |
| Starting | Background image or video, “Starting soon” text |
| Main | Camera, game or screen capture, microphone |
| Chatting | Camera or background, chat, microphone |
| Break | Image or video, optional music |
| Ending | Closing screen, optional music |

This is only a suggested layout. Use one scene, ten scenes, or your own roles. All scenes except the internal scene used for the shelf appear in the remote in OBS order.

For each scene:

1. Add sources in OBS.
2. Arrange the layers in OBS.
3. Check source visibility and locks.
4. Switch to the scene in OBS and check the output.
5. Open OBS Remote; changes will appear automatically.

## 3. Set up audio, donations, and music

Add audio through OBS sources, for example:

- a microphone or audio output capture;
- a Browser Source for donations, alerts, or chat;
- music captured from a browser, YouTube, Yandex Music, or another application;
- a Media Source with a local file;
- OBS plugin sources.

The **Mixer** («Микшер») shows sources for which OBS exposes audio controls, using their OBS names. The remote does not identify a service by its name, so you can use your preferred donation platform or music source.

Add the same source to each scene where you need it. OBS keeps the source settings shared, while layer visibility can be controlled separately in each scene. Muting a shared source affects that source wherever it is used.

For a donation widget, check that:

1. Its Browser Source opens the correct URL.
2. The source is enabled in the appropriate scene.
3. You can hear a test alert using OBS audio monitoring and the selected monitoring device.

Avoid capturing the same audio through both Desktop Audio and a separate audio capture source, or viewers may hear it twice.

## 4. Make sources easy to control

The remote can:

- switch scenes and show or hide sources;
- reorder and lock layers;
- edit supported text sources and change a Window Capture selection;
- move, resize, and rotate visible sources;
- add existing sources and new text, images, video, or windows.

Give sources recognizable names such as `Camera`, `Game`, `Microphone`, `Music`, `Donations`, and `Chat`. These names are suggestions, not requirements.

Lock finished background elements in OBS. Leave sources you want to move during a stream unlocked.

## 5. Connect your phone

1. Start OBS.
2. Run `Пульт OBS/start-remote.cmd`.
3. Open `http://127.0.0.1:8787/pair` on the OBS computer.
4. Connect your phone to the same Wi-Fi network.
5. Scan the QR code or enter the address and code manually.

After connecting:

- switch a scene on the phone and check it in OBS;
- show and hide a source;
- mute and unmute a test source;
- change the scene in OBS and wait for the remote to update.

The last check confirms both directions: the remote controls OBS, and changes made in OBS appear in the remote.

## 6. Example layout

[`scene-layout.example.json`](./scene-layout.example.json) is a neutral example for planning and documenting your setup. OBS Remote does not import it automatically or require those names.

If a source is missing from the remote, first check that it belongs to the current program scene in OBS. A source in another scene appears after you switch to that scene.
