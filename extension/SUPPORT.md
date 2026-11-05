# Rium Download 2.8.4

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

## Instagram layout (2.8.4)

Instagram download controls sit 8px outside the media at its upper-right edge, stacked vertically (video above audio). Other sites retain their existing layout. Photos still hide the audio button. Very narrow viewports with no right-side gutter have not been verified.

## 설치파일
Windows EXE / Mac Intel·Apple Silicon DMG를 제공합니다. 파일과 Chrome·Edge 도우미는 설치기가 연결하며, 비스토어 확장 추가는 브라우저별 사용자 단계가 필요합니다. Aside 자동 설치 API는 확인되지 않았습니다. 설치 중 다운로드를 실행하지 마세요.

## 유튜브 단축키
유튜브에서는 확장의 프레임 이동만 사용합니다. Windows는 Ctrl + 좌우 방향키, Mac은 Option + 좌우 방향키를 사용할 수 있습니다. 나머지 키는 유튜브가 처리합니다. 다른 사이트의 확장 단축키는 그대로 유지합니다.

## 직접 업데이트
새 버전이 표시되면 지금 업데이트를 눌러 최신 확장과 도우미를 내려받고 적용합니다. 시작하기 전에 모든 브라우저의 Rium Download 작업을 완료하세요. 2.8.3 이하에서 처음 전환할 때와 표준 설치가 아닌 경우에는 설치파일을 한 번 다시 실행해야 합니다. 설치본과 다른 확장 ID의 설정을 자동 이전하지 않습니다.
