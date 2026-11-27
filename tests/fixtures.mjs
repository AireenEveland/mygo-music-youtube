// Shapes of the answers YouTube's website gives. These stand in for the real
// API in the offline tests; they are deliberately loose, as the answers are.

const art = (id, host = "i.ytimg.com") => `https://${host}/vi/${id}/hq720.jpg`;

export const thumb = (id, width = 1280) => ({
  thumbnails: [
    { url: art(id), width: 480, height: 360 },
    { url: art(id), width, height: Math.round((width * 9) / 16) },
  ],
});

export function video(id, name, { channel = "Channel One", channelId = "UCchannel1", length = "3:45" } = {}) {
  return {
    videoId: id,
    thumbnail: thumb(id),
    title: { runs: [{ text: name }] },
    longBylineText: {
      runs: [{ text: channel, navigationEndpoint: { browseEndpoint: { browseId: channelId } } }],
    },
    lengthText: { simpleText: length },
    navigationEndpoint: { watchEndpoint: { videoId: id } },
  };
}

export function playlistVideo(id, name, { length = "4:20" } = {}) {
  return {
    videoId: id,
    thumbnail: thumb(id),
    title: { runs: [{ text: name }] },
    shortBylineText: { runs: [{ text: "Channel One" }] },
    lengthText: { simpleText: length },
  };
}

export function lockup(id, name, { type = "LOCKUP_CONTENT_TYPE_VIDEO", length = "5:10", channel = "Channel Two" } = {}) {
  return {
    contentId: id,
    contentType: type,
    metadata: {
      lockupMetadataViewModel: {
        title: { content: name },
        contentMetadataViewModel: {
          metadataRows: [{ metadataParts: [{ text: { content: channel } }, { text: { content: length } }] }],
        },
      },
    },
    contentImage: { thumbnailViewModel: { image: { sources: [{ url: art(id), width: 720, height: 404 }] } } },
  };
}

export function channel(id, name) {
  return {
    channelId: id,
    title: { simpleText: name },
    thumbnail: { thumbnails: [{ url: `https://yt3.ggpht.com/${id}`, width: 68, height: 68 }] },
    navigationEndpoint: { browseEndpoint: { browseId: id } },
  };
}

export function playlist(id, name, { count = "12 videos", owner = "Me" } = {}) {
  return {
    playlistId: id,
    title: { simpleText: name },
    thumbnails: [thumb(id)],
    videoCountText: { simpleText: count },
    shortBylineText: { simpleText: owner },
  };
}

export const continuationItem = (token) => ({
  continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } },
});

export const searchAnswer = (items, token = "") => ({
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [
            { itemSectionRenderer: { contents: items } },
            ...(token ? [continuationItem(token)] : []),
          ],
        },
      },
    },
  },
});

export const shelf = (title, items) => ({
  richShelfRenderer: { title: { simpleText: title }, contents: items.map((x) => ({ richItemRenderer: { content: x } })) },
});

export const browseAnswer = (contents, token = "") => ({
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [...contents, ...(token ? [continuationItem(token)] : [])] } } } }],
    },
  },
});

export const playlistAnswer = (tracks, { name = "Watch Later", token = "" } = {}) => ({
  header: {
    playlistHeaderRenderer: {
      title: { simpleText: name },
      ownerText: { simpleText: "Me" },
      description: { simpleText: "Saved for later" },
    },
  },
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
        { itemSectionRenderer: { contents: [
          { playlistVideoListRenderer: { contents: [...tracks, ...(token ? [continuationItem(token)] : [])] } },
        ] } },
      ] } } } }],
    },
  },
});

export const accountMenu = (name = "My Account") => ({
  actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { header: {
    activeAccountHeaderRenderer: {
      accountName: { simpleText: name },
      channelHandle: { simpleText: "@me" },
      accountPhoto: { thumbnails: [{ url: "https://yt3.ggpht.com/avatar", width: 88, height: 88 }] },
    },
  } } } } }],
});

export const visitorId = { responseContext: { visitorData: "VISITOR-123" } };

export const player = ({
  status = "OK",
  reason = "",
  formats = [
    { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, contentLength: "3000000", url: "https://rr1---sn-test.googlevideo.com/videoplayback?id=128" },
    { itag: 141, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 256000, contentLength: "6000000", url: "https://rr1---sn-test.googlevideo.com/videoplayback?id=256" },
    { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, url: "https://rr1---sn-test.googlevideo.com/videoplayback?id=opus" },
    { itag: 139, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 48000, signatureCipher: "s=needs-js" },
    { itag: 142, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 300000, isDrc: true, url: "https://rr1---sn-test.googlevideo.com/videoplayback?id=drc" },
  ],
  tracking = playbackTracking(),
} = {}) => ({
  playabilityStatus: { status, reason },
  videoDetails: { lengthSeconds: "225" },
  playerConfig: { audioConfig: { trackAbsoluteLoudnessLkfs: -14 } },
  streamingData: { adaptiveFormats: formats },
  playbackTracking: tracking,
});

// The addresses YouTube's own player reports a play and its watch time to.
export const playbackURL = "https://www.youtube.com/api/stats/playback?docid=v1&ei=AA&fexp=1&ns=yt&plid=PL&el=detailpage";

export const playbackTracking = (baseUrl = playbackURL) => ({
  videostatsPlaybackUrl: { baseUrl },
  videostatsWatchtimeUrl: { baseUrl: "https://s.youtube.com/api/stats/watchtime?docid=v1" },
  videostatsDelayplayUrl: { baseUrl },
});

export const http = (status, body = {}) => ({ __http: status, body });

export const audioURL = (tag) => `https://rr1---sn-test.googlevideo.com/videoplayback?id=${tag}`;

// Only Opus in WebM: the case a plugin that relies on the app's own decoder
// cannot play, and ffmpeg can.
export const opusOnly = [
  { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, url: audioURL("opus") },
];

// No plain url: YouTube wants its JavaScript worked out before it gives one.
export const signedOnly = [
  { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, signatureCipher: "s=needs-js" },
];

export const ytdlpLine = (url = "https://ytdlp.example/audio", headers = { "User-Agent": "yt-dlp" }) =>
  JSON.stringify({ url, http_headers: headers });
