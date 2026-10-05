// Team detection drives the rail filter and the per-story tag chips.
// Aliases matter more than the official name: nobody writes "Los Angeles
// Clippers" in a headline, they write "Clippers" or "LAC".

// Nicknames and cities are kept apart deliberately. Tagging uses both, but the
// mixed-sport filter may only trust nicknames: "Memphis", "Boston" and
// "Philadelphia" are also college-football, NFL and NHL cities.
export const TEAMS = [
  ['atl', 'Hawks',        'ATL', ['hawks'],                  ['atlanta']],
  ['bos', 'Celtics',      'BOS', ['celtics'],                ['boston']],
  ['bkn', 'Nets',         'BKN', ['nets'],                   ['brooklyn']],
  ['cha', 'Hornets',      'CHA', ['hornets'],                ['charlotte']],
  ['chi', 'Bulls',        'CHI', ['bulls'],                  ['chicago']],
  ['cle', 'Cavaliers',    'CLE', ['cavaliers', 'cavs'],      ['cleveland']],
  ['dal', 'Mavericks',    'DAL', ['mavericks', 'mavs'],      ['dallas']],
  ['den', 'Nuggets',      'DEN', ['nuggets'],                ['denver']],
  ['det', 'Pistons',      'DET', ['pistons'],                ['detroit']],
  ['gsw', 'Warriors',     'GSW', ['warriors', 'dubs'],       ['golden state']],
  ['hou', 'Rockets',      'HOU', ['rockets'],                ['houston']],
  ['ind', 'Pacers',       'IND', ['pacers'],                 ['indiana']],
  ['lac', 'Clippers',     'LAC', ['clippers'],               ['la clippers']],
  ['lal', 'Lakers',       'LAL', ['lakers'],                 ['la lakers']],
  ['mem', 'Grizzlies',    'MEM', ['grizzlies', 'grizz'],     ['memphis']],
  ['mia', 'Heat',         'MIA', ['heat'],                   ['miami']],
  ['mil', 'Bucks',        'MIL', ['bucks'],                  ['milwaukee']],
  ['min', 'Timberwolves', 'MIN', ['timberwolves', 'wolves'], ['minnesota']],
  ['nop', 'Pelicans',     'NOP', ['pelicans', 'pels'],       ['new orleans']],
  ['nyk', 'Knicks',       'NYK', ['knicks'],                 ['new york']],
  ['okc', 'Thunder',      'OKC', ['thunder'],                ['oklahoma city']],
  ['orl', 'Magic',        'ORL', ['magic'],                  ['orlando']],
  ['phi', '76ers',        'PHI', ['76ers', 'sixers'],        ['philadelphia', 'philly']],
  ['phx', 'Suns',         'PHX', ['suns'],                   ['phoenix']],
  ['por', 'Trail Blazers','POR', ['trail blazers', 'blazers'], ['portland']],
  ['sac', 'Kings',        'SAC', ['kings'],                  ['sacramento']],
  ['sas', 'Spurs',        'SAS', ['spurs'],                  ['san antonio']],
  ['tor', 'Raptors',      'TOR', ['raptors', 'raps'],        ['toronto']],
  ['uta', 'Jazz',         'UTA', ['jazz'],                   ['utah']],
  ['was', 'Wizards',      'WAS', ['wizards'],                ['washington']],
].map(([id, name, abbr, nicknames, cities]) => ({
  id, name, abbr, nicknames, cities, aliases: [...nicknames, ...cities],
}));

export const TEAM_BY_ID = new Map(TEAMS.map((t) => [t.id, t]));

// One pass, one regex. Alternation is ordered longest-first so "la clippers"
// wins over "clippers" and can't be shadowed by a shorter alias.
const ALIAS_INDEX = [];
for (const t of TEAMS) for (const a of t.aliases) ALIAS_INDEX.push([a, t.id]);
ALIAS_INDEX.sort((a, b) => b[0].length - a[0].length);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TEAM_RE = new RegExp(`\\b(${ALIAS_INDEX.map(([a]) => escape(a)).join('|')})\\b`, 'gi');
const ALIAS_TO_ID = new Map(ALIAS_INDEX);

// Nicknames only — the one team signal strong enough to call something NBA.
const NICKNAMES = TEAMS.flatMap((t) => t.nicknames).sort((a, b) => b.length - a.length);
const NICK_RE = new RegExp(`\\b(${NICKNAMES.map(escape).join('|')})\\b`, 'i');

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
const NBA_HINTS = /\b(nba|basketball|hoops|g[- ]league|summer league)\b/i;
const NBA_PATH = /\/(nba|basketball)\//i;

// A sport as its own path segment is a hard signal about what the article is.
const OTHER_SPORT_PATH = /\/(nfl|mlb|nhl|soccer|football|golf|pga|tennis|ufc|mma|boxing|wwe|nascar|olympics|racing|college-football|cfb|f1)\//i;

// ...but outlets also bury the sport in the slug under a generic section, e.g.
// /editorials/flyers-biggest-mistake-so-far-in-2026-nhl-free-agency
const OTHER_SPORT_WORD = /\b(nfl|mlb|nhl|soccer|premier league|la liga|golf|pga|tennis|ufc|mma|boxing|wwe|nascar|formula 1|college football|super bowl|world series|stanley cup|touchdown|quarterback|qb|wide receiver|running back|home run|innings|pitcher|goaltender|power play|end zone)\b/i;

/**
 * Does this item positively advertise a different sport?
 *
 * The lenient half of the filter: it only rejects, never requires proof of
 * basketball, so it is safe on NBA-focused feeds that occasionally carry
 * another sport.
 */
export function otherSportSignal(item) {
  const link = item.link || '';
  if (NBA_PATH.test(link)) return false;
  if (OTHER_SPORT_PATH.test(link)) return true;
  const text = `${item.title} ${(item.categories || []).join(' ')}`;
  const slug = link.replace(/[-_/.]+/g, ' ');
  return OTHER_SPORT_WORD.test(slug) || OTHER_SPORT_WORD.test(text);
}

/**
 * Is this item positively basketball? The strict half — it demands evidence,
 * so it is only safe on feeds that are mostly *not* NBA.
 */
export function looksLikeNBA(item) {
  const link = item.link || '';
  if (NBA_PATH.test(link)) return true;
  if (otherSportSignal(item)) return false;

  const text = `${item.title} ${item.categories.join(' ')}`;
  const slug = link.replace(/[-_/.]+/g, ' ');
  if (NBA_HINTS.test(text)) return true;
  // Nicknames only, in the headline or the URL slug. A bare city cannot carry
  // an item: "UNLV QB ... vs. Memphis" is college football, not a Grizzlies
  // story, but /editorials/lakers-luka-future plainly is NBA.
  return NICK_RE.test(text) || NICK_RE.test(slug);
}

// ---------------------------------------------------------------------------
// WNBA
// ---------------------------------------------------------------------------
//
// This is an NBA wire, so the WNBA is a separate league to exclude rather than
// a basketball signal to accept. It has to be checked on every source, not just
// the mixed-sport ones: RealGM, TalkBasket and Yahoo all carry WNBA items in
// their NBA feeds.

const WNBA_LEAGUE = /\b(wnba|women'?s national basketball|women'?s basketball|ncaaw)\b/i;

// City-qualified almost everywhere, because the bare nicknames collide with
// ordinary words ("storm", "sky", "fever", "sun", "dream", "liberty", "sparks").
const WNBA_TEAM = new RegExp(
  '\\b(' + [
    'las vegas aces', 'new york liberty', 'chicago sky', 'indiana fever',
    'seattle storm', 'phoenix mercury', 'connecticut sun', 'atlanta dream',
    'minnesota lynx', 'dallas wings', 'washington mystics', 'los angeles sparks',
    'la sparks', 'golden state valkyries', 'toronto tempo', 'portland fire',
    'valkyries', 'mystics',
  ].join('|') + ')\\b', 'i');

/**
 * Is this a WNBA item? Excluded everywhere on the wire.
 *
 * An explicit NBA section in the path outranks a WNBA mention anywhere else:
 * /nba/news/timberwolves-lynx-ownership-shakeup-nba-wnba-marc-stad is an NBA
 * ownership story that happens to name the WNBA team in the same deal.
 */
export function isWomensBasketball(item) {
  const link = item.link || '';
  if (NBA_PATH.test(link)) return false;

  const slug = link.replace(/[-_/.]+/g, ' ');
  const text = `${item.title} ${(item.categories || []).join(' ')}`;

  if (WNBA_LEAGUE.test(slug) || WNBA_LEAGUE.test(text)) return true;
  if (WNBA_TEAM.test(slug) || WNBA_TEAM.test(text)) return true;

  // The summary is a weaker signal, so only the explicit league name counts
  // there — a team nickname in body text is too easily a coincidence.
  return !!item.summary && WNBA_LEAGUE.test(item.summary);
}

// ---------------------------------------------------------------------------
// Basketball, but not the NBA
// ---------------------------------------------------------------------------
//
// TalkBasket and RealGM cover world basketball, so EuroLeague roster moves and
// FIBA qualifiers arrive in the same feeds as NBA news. They read as a different
// sport entirely on an NBA wire — "Bosna replaces Monaco in the EuroCup" is not
// what anyone came here for.
//
// The distinction that matters is not the competition but whether an NBA club is
// in the frame: "Nuggets star Nikola Jokic plays through illness on FIBA duty"
// is NBA news; "Giannis-less Greece defeats Spain" is not.

const INTL_COMP = new RegExp('\\b(' + [
  'euroleague', 'eurocup', 'eurobasket', 'basketball champions league', 'bcl',
  'fiba', 'aba league', 'adriatic league', 'vtb', 'liga acb', 'acb',
  'lnb pro', 'nationale masculine', 'nm1', 'lega basket', 'greek basket league',
  'world cup qualifier', 'world cup qualifiers', 'world cup qualifying',
  'olympic qualifier', 'olympic qualifiers', 'afrobasket', 'asia cup',
  'national team', 'euroleague basketball',
].join('|') + ')\\b', 'i');

// Matched against the headline and URL only — the club is the story's subject
// there, whereas a passing mention in body text usually is not.
const INTL_CLUB = new RegExp('\\b(' + [
  'real madrid', 'barcelona', 'partizan', 'crvena zvezda', 'red star belgrade',
  'zalgiris', 'panathinaikos', 'olympiacos', 'olympiakos', 'fenerbahce',
  'fenerbahçe', 'maccabi', 'anadolu efes', 'baskonia', 'valencia basket',
  'virtus bologna', 'olimpia milano', 'asvel', 'alba berlin', 'bayern munich',
  'zenit', 'cska', 'hapoel', 'bosna', 'monaco', 'unicaja', 'joventut',
  'buducnost', 'cedevita', 'paris basketball', 'dubai bc',
].join('|') + ')\\b', 'i');

/** Non-NBA basketball: European club ball and international competition. */
export function isNonNbaBasketball(item) {
  const link = item.link || '';
  if (NBA_PATH.test(link)) return false;

  const slug = link.replace(/[-_/.]+/g, ' ');
  const headline = `${item.title} ${slug}`;
  const all = `${item.title} ${(item.categories || []).join(' ')} ${item.summary || ''}`;

  const international = INTL_COMP.test(all) || INTL_COMP.test(slug) || INTL_CLUB.test(headline);
  if (!international) return false;

  // An NBA club anywhere in the story keeps it: that is a player on national
  // duty, which is NBA news. Cities count here as well as nicknames — this is
  // the permissive direction, and "Portland would not clear him to play" is a
  // Blazers story even though it never says Blazers.
  return detectTeams(all).length === 0;
}
