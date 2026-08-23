// Team detection drives the rail filter and the per-story tag chips.
// Aliases matter more than the official name: nobody writes "Los Angeles
// Clippers" in a headline, they write "Clippers" or "LAC".

export const TEAMS = [
  ['atl', 'Hawks',        'ATL', ['hawks', 'atlanta']],
  ['bos', 'Celtics',      'BOS', ['celtics', 'boston']],
  ['bkn', 'Nets',         'BKN', ['nets', 'brooklyn']],
  ['cha', 'Hornets',      'CHA', ['hornets', 'charlotte']],
  ['chi', 'Bulls',        'CHI', ['bulls', 'chicago']],
  ['cle', 'Cavaliers',    'CLE', ['cavaliers', 'cavs', 'cleveland']],
  ['dal', 'Mavericks',    'DAL', ['mavericks', 'mavs', 'dallas']],
  ['den', 'Nuggets',      'DEN', ['nuggets', 'denver']],
  ['det', 'Pistons',      'DET', ['pistons', 'detroit']],
  ['gsw', 'Warriors',     'GSW', ['warriors', 'golden state', 'dubs']],
  ['hou', 'Rockets',      'HOU', ['rockets', 'houston']],
  ['ind', 'Pacers',       'IND', ['pacers', 'indiana']],
  ['lac', 'Clippers',     'LAC', ['clippers', 'la clippers']],
  ['lal', 'Lakers',       'LAL', ['lakers', 'la lakers']],
  ['mem', 'Grizzlies',    'MEM', ['grizzlies', 'grizz', 'memphis']],
  ['mia', 'Heat',         'MIA', ['heat', 'miami']],
  ['mil', 'Bucks',        'MIL', ['bucks', 'milwaukee']],
  ['min', 'Timberwolves', 'MIN', ['timberwolves', 'wolves', 'minnesota']],
  ['nop', 'Pelicans',     'NOP', ['pelicans', 'pels', 'new orleans']],
  ['nyk', 'Knicks',       'NYK', ['knicks', 'new york']],
  ['okc', 'Thunder',      'OKC', ['thunder', 'oklahoma city']],
  ['orl', 'Magic',        'ORL', ['magic', 'orlando']],
  ['phi', '76ers',        'PHI', ['76ers', 'sixers', 'philadelphia', 'philly']],
  ['phx', 'Suns',         'PHX', ['suns', 'phoenix']],
  ['por', 'Trail Blazers','POR', ['trail blazers', 'blazers', 'portland']],
  ['sac', 'Kings',        'SAC', ['kings', 'sacramento']],
  ['sas', 'Spurs',        'SAS', ['spurs', 'san antonio']],
  ['tor', 'Raptors',      'TOR', ['raptors', 'raps', 'toronto']],
  ['uta', 'Jazz',         'UTA', ['jazz', 'utah']],
  ['was', 'Wizards',      'WAS', ['wizards', 'washington']],
].map(([id, name, abbr, aliases]) => ({ id, name, abbr, aliases }));

export const TEAM_BY_ID = new Map(TEAMS.map((t) => [t.id, t]));

// One pass, one regex. Alternation is ordered longest-first so "la clippers"
// wins over "clippers" and can't be shadowed by a shorter alias.
const ALIAS_INDEX = [];
for (const t of TEAMS) for (const a of t.aliases) ALIAS_INDEX.push([a, t.id]);
ALIAS_INDEX.sort((a, b) => b[0].length - a[0].length);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TEAM_RE = new RegExp(`\\b(${ALIAS_INDEX.map(([a]) => escape(a)).join('|')})\\b`, 'gi');
const ALIAS_TO_ID = new Map(ALIAS_INDEX);

/** Team ids mentioned in the text, in first-appearance order, max 3. */
export function detectTeams(text) {
  if (!text) return [];
  TEAM_RE.lastIndex = 0;
  const seen = [];
  let m;
  while ((m = TEAM_RE.exec(text))) {
    const id = ALIAS_TO_ID.get(m[1].toLowerCase());
    if (id && !seen.includes(id)) {
      seen.push(id);
      if (seen.length === 3) break;
    }
  }
  return seen;
}

// Signals that a story from a mixed-sport feed is actually basketball.
const NBA_HINTS = /\b(nba|basketball|hoops|wnba|g[- ]league|summer league)\b/i;
const NBA_PATH = /\/(nba|basketball)\//i;

// A sport as its own path segment is a hard signal about what the article is.
const OTHER_SPORT_PATH = /\/(nfl|mlb|nhl|soccer|football|golf|pga|tennis|ufc|mma|boxing|wwe|nascar|olympics|racing|college-football|cfb|f1)\//i;

// ...but outlets also bury the sport in the slug under a generic section, e.g.
// /editorials/flyers-biggest-mistake-so-far-in-2026-nhl-free-agency
const OTHER_SPORT_WORD = /\b(nfl|mlb|nhl|soccer|premier league|la liga|golf|pga|tennis|ufc|mma|boxing|wwe|nascar|formula 1|college football|super bowl|world series|stanley cup)\b/i;

/** Is this item basketball? Used to filter feeds that carry every sport. */
export function looksLikeNBA(item, teamIds) {
  const link = item.link || '';
  if (NBA_PATH.test(link)) return true;
  if (OTHER_SPORT_PATH.test(link)) return false;

  const text = `${item.title} ${item.categories.join(' ')}`;
  const slug = link.replace(/[-_/.]+/g, ' ');
  if (OTHER_SPORT_WORD.test(slug) || OTHER_SPORT_WORD.test(text)) return false;

  if (NBA_HINTS.test(text)) return true;
  // Team names come last: city aliases like "Philadelphia" and "Boston" match
  // other leagues too, so they must never outrank an explicit sport signal.
  return teamIds.length > 0;
}
