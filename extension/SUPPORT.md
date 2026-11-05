# Rium Download 2.8.0

## Download support

- HTTP(S) HTML5 video files (MP4, M4V, WebM, Ogg/OGV, MOV) and extensionless loaded video URLs.
- Completed non-DRM HLS: MPEG-TS, fragmented MP4, initialization maps, explicit/implicit byte ranges, and supported separate fMP4 video/AAC audio.
- Static single-period MPEG-DASH: SegmentTemplate Number/Time, bounded SegmentTimeline, SegmentList with ranges, progressive MP4 BaseURL; supported separate video/AAC tracks are losslessly muxed.
- HTML5 sources plus element-bound Video.js, JW Player, Plyr, Shaka, dash.js, Hls.js, Clappr and Flowplayer APIs. Player instances must expose the supported API and be associated with the selected video. A brand name alone does not guarantee support.
- Open shadow roots and same-origin iframe traversal. Cross-origin iframe discovery requires granted access to the frame origin and an enabled parent site. Popup offers an explicit connection button when visible iframe origins lack permission.
- Existing Instagram/X handlers, shortcuts, queue and global overlay visibility setting are retained.

## Boundaries

- No DRM/access-control bypass, encrypted adaptive streams, live recording, dynamic/multi-period DASH, discontinuities, DASH SegmentBase/index addressing, nonzero presentationTimeOffset, separate raw AAC/TS audio, or closed shadow roots.
- Existing legacy AES-128 HLS path remains limited to the original integrations; the new adaptive path rejects encryption.
- Exact origin permissions are checked for every adaptive resource. Redirects and unhonored byte ranges fail explicitly. Ambiguous unrelated resource manifests are not guessed.
- New adaptive limits: 2 MB manifests, at most 12 variants, 10,000 combined segments, 32 resource origins, 256 MiB single-track input or 80 MiB combined separate-track input. Separate-track mux codec/layout limits remain unchanged.
- Site must be enabled in the popup. Download/server permissions are requested only when needed. Hiding the overlay does not disable shortcuts or cancel jobs.

## Verification scope

Local, self-generated 8-second H.264/AAC fixtures were played with real Hls.js/dash.js. Browser queue downloads exercised native HTML5, extensionless sources, HLS TS, muxed fMP4, byte ranges, separate HLS A/V, DASH A/V, open shadow DOM and authorized cross-origin iframe paths. Decoding and stream/packet checks were performed on saved test outputs. Player-specific association fixtures cover other APIs; this is not a claim of testing every third-party website.

## Audio-only downloads (2.7.0)

- Camera button: existing video/photo download; musical-note button: audio-only M4A. Photos hide the musical-note button.
- Original AAC packets are remuxed without transcoding. MP3 conversion, WebM/Opus and unsupported audio layouts are not included.
- Instagram DASH and supported separate-track adaptive streams fetch the audio track only. Muxed MP4/TS sources require fetching the source before extracting AAC.
- Audio requests share the sequential queue, save-location preference, cancellation, and progress UI. Labels use [음원].
- Audio input is bounded to 80 MiB; DRM, missing audio, unsafe layouts and unsupported codecs fail explicitly rather than saving video as an audio file.

## YouTube (2.8.0)

Public VOD and Shorts use an on-demand native helper. Best video+audio are remuxed to MKV; best AAC is saved as M4A. No cookie extraction, live recording or DRM support. Windows and macOS packages bundle the helper and tools. Popup checks GitHub releases; upgrades remain user-initiated. No tray, service or autostart.
