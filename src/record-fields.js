const str=value=>typeof value==='string'?value:'';
const parseTime=value=>{const time=Date.parse(value);return Number.isNaN(time)?null:time;};

export const getVideoId=record=>str(record?.video_id);
export const getUrl=record=>str(record?.url);
export const getTitle=record=>str(record?.title_clean)||str(record?.title_raw)||str(record?.title);
export const getTitleRaw=record=>str(record?.title_raw);
export const getChannel=record=>str(record?.channel);
export const getChannelUrl=record=>str(record?.channel_url);
export const getArtist=record=>str(record?.artist_guess)||null;
export const getPlayCount=record=>Number.isFinite(record?.play_count)?record.play_count:null;
export const getLastPlayed=record=>parseTime(record?.last_played);
export const getFirstPlayed=record=>parseTime(record?.first_played);
