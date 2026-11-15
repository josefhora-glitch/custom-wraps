// Statické informace o týmech NFL (zkratky dle ESPN), divize a barvy pro textové odznaky.
// Loga týmů se z právních důvodů nepoužívají – web zobrazuje jen zkratku v barvě týmu.
export const TEAMS = {
  BAL: { name: 'Baltimore Ravens', short: 'Ravens', div: 'AFC North', color: '#241773' },
  CIN: { name: 'Cincinnati Bengals', short: 'Bengals', div: 'AFC North', color: '#FB4F14' },
  CLE: { name: 'Cleveland Browns', short: 'Browns', div: 'AFC North', color: '#FF3C00' },
  PIT: { name: 'Pittsburgh Steelers', short: 'Steelers', div: 'AFC North', color: '#FFB612' },
  BUF: { name: 'Buffalo Bills', short: 'Bills', div: 'AFC East', color: '#00338D' },
  MIA: { name: 'Miami Dolphins', short: 'Dolphins', div: 'AFC East', color: '#008E97' },
  NE: { name: 'New England Patriots', short: 'Patriots', div: 'AFC East', color: '#002244' },
  NYJ: { name: 'New York Jets', short: 'Jets', div: 'AFC East', color: '#125740' },
  HOU: { name: 'Houston Texans', short: 'Texans', div: 'AFC South', color: '#03202F' },
  IND: { name: 'Indianapolis Colts', short: 'Colts', div: 'AFC South', color: '#002C5F' },
  JAX: { name: 'Jacksonville Jaguars', short: 'Jaguars', div: 'AFC South', color: '#006778' },
  TEN: { name: 'Tennessee Titans', short: 'Titans', div: 'AFC South', color: '#4B92DB' },
  DEN: { name: 'Denver Broncos', short: 'Broncos', div: 'AFC West', color: '#FB4F14' },
  KC: { name: 'Kansas City Chiefs', short: 'Chiefs', div: 'AFC West', color: '#E31837' },
  LV: { name: 'Las Vegas Raiders', short: 'Raiders', div: 'AFC West', color: '#A5ACAF' },
  LAC: { name: 'Los Angeles Chargers', short: 'Chargers', div: 'AFC West', color: '#0080C6' },
  CHI: { name: 'Chicago Bears', short: 'Bears', div: 'NFC North', color: '#0B162A' },
  DET: { name: 'Detroit Lions', short: 'Lions', div: 'NFC North', color: '#0076B6' },
  GB: { name: 'Green Bay Packers', short: 'Packers', div: 'NFC North', color: '#203731' },
  MIN: { name: 'Minnesota Vikings', short: 'Vikings', div: 'NFC North', color: '#4F2683' },
  DAL: { name: 'Dallas Cowboys', short: 'Cowboys', div: 'NFC East', color: '#003594' },
  NYG: { name: 'New York Giants', short: 'Giants', div: 'NFC East', color: '#0B2265' },
  PHI: { name: 'Philadelphia Eagles', short: 'Eagles', div: 'NFC East', color: '#004C54' },
  WSH: { name: 'Washington Commanders', short: 'Commanders', div: 'NFC East', color: '#5A1414' },
  ATL: { name: 'Atlanta Falcons', short: 'Falcons', div: 'NFC South', color: '#A71930' },
  CAR: { name: 'Carolina Panthers', short: 'Panthers', div: 'NFC South', color: '#0085CA' },
  NO: { name: 'New Orleans Saints', short: 'Saints', div: 'NFC South', color: '#D3BC8D' },
  TB: { name: 'Tampa Bay Buccaneers', short: 'Buccaneers', div: 'NFC South', color: '#D50A0A' },
  ARI: { name: 'Arizona Cardinals', short: 'Cardinals', div: 'NFC West', color: '#97233F' },
  LAR: { name: 'Los Angeles Rams', short: 'Rams', div: 'NFC West', color: '#003594' },
  SF: { name: 'San Francisco 49ers', short: '49ers', div: 'NFC West', color: '#AA0000' },
  SEA: { name: 'Seattle Seahawks', short: 'Seahawks', div: 'NFC West', color: '#002244' },
};

// ESPN občas používá alternativní zkratky.
const ALIASES = { WAS: 'WSH', JAC: 'JAX', LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
export const normAbbr = (a) => {
  const up = String(a || '').toUpperCase();
  return ALIASES[up] || up;
};

export const POSITION_CS = {
  QB: 'Quarterback', RB: 'Running back', FB: 'Fullback', WR: 'Wide receiver', TE: 'Tight end',
  OT: 'Offensive tackle', T: 'Offensive tackle', OG: 'Guard', G: 'Guard', C: 'Center', OL: 'Ofenzivní lajna',
  DE: 'Defensive end', DT: 'Defensive tackle', NT: 'Nose tackle', DL: 'Defenzivní lajna',
  LB: 'Linebacker', ILB: 'Inside linebacker', OLB: 'Outside linebacker', MLB: 'Middle linebacker',
  CB: 'Cornerback', S: 'Safety', FS: 'Free safety', SS: 'Strong safety', DB: 'Defensive back',
  K: 'Kicker', PK: 'Kicker', P: 'Punter', LS: 'Long snapper',
};

export const INJURY_STATUS_CS = {
  out: 'Nehraje (out)',
  doubtful: 'Start nepravděpodobný (doubtful)',
  questionable: 'Start nejistý (questionable)',
  probable: 'Pravděpodobně nastoupí',
  'injured reserve': 'Listina zraněných (IR)',
  'day-to-day': 'Den ode dne',
  active: 'K dispozici',
  suspension: 'Suspendován',
  'physically unable to perform': 'PUP listina',
};
