/**
 * GET /api/pages?date=YYYY-MM-DD
 * Aggregates data from:
 *   - daily_achievment_count_ecms  → category-wise news published
 *   - qc_review                    → QC mistakes in newspaper
 *   - visit_report                 → field visits (with lat/lng for map)
 *
 * NOTE: LATITUDE / LONGITUDE columns in visit_report are swapped in the DB.
 *       lat = LONGITUDE column, lng = LATITUDE column.
 */
const { query }       = require('./_lib/mysql');
const { requireRole } = require('./_lib/auth');
const { setCors, handleOptions } = require('./_lib/cors');

// ── News category label map ────────────────────────────────────────────────────
const CAT_KEYS = [
  ['routine',     'Routine_News',    'Routine News'],
  ['exclusive',   'Exclusive',       'Exclusive'],
  ['human_angle', 'Human_angle',     'Human Angle'],
  ['datastory',   'Datastory',       'Data Story'],
  ['expose',      'Expose_khulasa',  'Exposé / Khulasa'],
  ['spotlight',   'Spotlight',       'Spotlight'],
  ['interviews',  'Interviews',      'Interview'],
  ['sting',       'Sting_Operation', 'Sting Operation'],
  ['surveys',     'Surveys',         'Survey'],
  ['impact',      'Impact_Story',    'Impact Story'],
  ['campaign',    'News_Campaign',   'News Campaign'],
  ['press_note',  'Press_Note',      'Press Note'],
  ['tippani',     'Tippani',         'Tippani'],
  ['patrika_view','Patrika_View',     'Patrika View'],
  ['others',      'Others',          'Others'],
];

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor', 'HR', 'Management', 'Legal']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  // Default to yesterday (latest complete day)
  const date = req.query.date || (() => {
    const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10);
  })();

  // 7-day range for trend
  const trendStart = (() => {
    const d = new Date(date); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10);
  })();

  // ── Resolve effective state/branch: role lock takes priority, then query params ─
  let filterState  = req.query.state  || '';
  let filterBranch = req.query.branch || '';

  // Role locks override query params — RE/State Head cannot widen beyond their scope
  if (user.role === 'State Head' && user.state)  { filterState = user.state; }  // filterBranch stays as selected
  if (user.role === 'Regional Editor') {
    if (user.state)  filterState  = user.state;
    if (user.branch) filterBranch = user.branch;
  }

  // ── Build WHERE fragments ─────────────────────────────────────────────────────
  // qc_review has a 'state' column  → filter directly
  // ecms & visit_report have pan_no → subquery join to user table
  const qcExtra    = [];  const qcParams   = [];
  const ecmsExtra  = [];  const ecmsParams = [];
  const visitExtra = [];  const visitParams= [];

  if (filterState && filterState !== 'All') {
    qcExtra.push('state = ?');   qcParams.push(filterState);
    ecmsExtra.push('Pan_no IN (SELECT pan_no FROM `user` WHERE State = ?)');  ecmsParams.push(filterState);
    visitExtra.push('pan_no IN (SELECT pan_no FROM `user` WHERE State = ?)'); visitParams.push(filterState);
  }
  if (filterBranch && filterBranch !== 'All') {
    ecmsExtra.push('Pan_no IN (SELECT pan_no FROM `user` WHERE Branch = ?)');  ecmsParams.push(filterBranch);
    visitExtra.push('pan_no IN (SELECT pan_no FROM `user` WHERE Branch = ?)'); visitParams.push(filterBranch);
  }

  const qcWhere    = qcExtra.length    ? ' AND ' + qcExtra.join(' AND ')    : '';
  const ecmsWhere  = ecmsExtra.length  ? ' AND ' + ecmsExtra.join(' AND ')  : '';
  const visitWhere = visitExtra.length ? ' AND ' + visitExtra.join(' AND ') : '';

  try {
    const [
      newsDay, newsTrend,
      qcSummary, qcByCat, qcBySeverity, qcRecent,
      visitSummary, visitByRemark, visitByTransport, visitMarkers, visitPersons,
      regLocations,
    ] = await Promise.all([

      // ── News: single day aggregate ──────────────────────────────────────────
      query(`SELECT COUNT(DISTINCT Pan_no) AS reporters,
          SUM(No_Story) AS stories, SUM(No_Words) AS words, SUM(No_Photo) AS photos,
          SUM(Exclusive) AS exclusive, SUM(Human_angle) AS human_angle,
          SUM(Datastory) AS datastory, SUM(Expose_khulasa) AS expose,
          SUM(Spotlight) AS spotlight, SUM(Interviews) AS interviews,
          SUM(Sting_Operation) AS sting, SUM(Surveys) AS surveys,
          SUM(Impact_Story) AS impact, SUM(News_Campaign) AS campaign,
          SUM(Routine_News) AS routine, SUM(Press_Note) AS press_note,
          SUM(Tippani) AS tippani, SUM(Patrika_View) AS patrika_view,
          SUM(Others) AS others
        FROM daily_achievment_count_ecms WHERE entrydate = ?${ecmsWhere}`,
        [date, ...ecmsParams]).catch(() => [{}]),

      // ── News: 7-day trend ───────────────────────────────────────────────────
      query(`SELECT entrydate AS d,
          SUM(No_Story) AS stories, SUM(No_Words) AS words, SUM(No_Photo) AS photos,
          SUM(Exclusive) AS exclusive, SUM(Routine_News) AS routine,
          SUM(Human_angle) AS human_angle, SUM(Datastory) AS datastory
        FROM daily_achievment_count_ecms
        WHERE entrydate BETWEEN ? AND ?${ecmsWhere}
        GROUP BY entrydate ORDER BY d ASC`,
        [trendStart, date, ...ecmsParams]).catch(() => []),

      // ── QC: summary ─────────────────────────────────────────────────────────
      query(`SELECT COUNT(*) AS total, SUM(no_of_mistake) AS mistakes
        FROM qc_review WHERE entrydate = ?${qcWhere}`,
        [date, ...qcParams]).catch(() => [{}]),

      // ── QC: by category ─────────────────────────────────────────────────────
      query(`SELECT category, COUNT(*) AS cnt, SUM(no_of_mistake) AS mistakes
        FROM qc_review WHERE entrydate = ?${qcWhere}
        GROUP BY category ORDER BY mistakes DESC`,
        [date, ...qcParams]).catch(() => []),

      // ── QC: by severity ─────────────────────────────────────────────────────
      query(`SELECT severity, COUNT(*) AS cnt
        FROM qc_review WHERE entrydate = ? AND severity != ''${qcWhere}
        GROUP BY severity ORDER BY FIELD(severity,'high','medium','low')`,
        [date, ...qcParams]).catch(() => []),

      // ── QC: 7-day recent list ───────────────────────────────────────────────
      query(`SELECT id, entrydate AS date, category, severity, state, edition,
               pullout, mistake, no_of_mistake, photo_url
        FROM qc_review WHERE entrydate BETWEEN ? AND ?${qcWhere}
        ORDER BY entrydate DESC, id DESC LIMIT 60`,
        [trendStart, date, ...qcParams]).catch(() => []),

      // ── Visits: summary ─────────────────────────────────────────────────────
      query(`SELECT COUNT(*) AS total,
          SUM(CASE WHEN LATITUDE IS NOT NULL AND LATITUDE != '' THEN 1 ELSE 0 END) AS with_loc,
          SUM(CASE WHEN TRIM(label_in_location) = 'Home' THEN 1 ELSE 0 END)           AS home_visits,
          SUM(CASE WHEN TRIM(label_in_location) = 'Patrika Office' THEN 1 ELSE 0 END) AS office_visits
        FROM visit_report WHERE visit_date = ?${visitWhere}`,
        [date, ...visitParams]).catch(() => [{}]),

      // ── Visits: by remark ───────────────────────────────────────────────────
      query(`SELECT TRIM(visit_remark) AS remark, COUNT(*) AS cnt
        FROM visit_report WHERE visit_date = ?
          AND visit_remark != '' AND visit_remark != 'Week Off'${visitWhere}
        GROUP BY remark ORDER BY cnt DESC LIMIT 10`,
        [date, ...visitParams]).catch(() => []),

      // ── Visits: by transport ────────────────────────────────────────────────
      query(`SELECT transport, COUNT(*) AS cnt
        FROM visit_report WHERE visit_date = ?
          AND transport NOT IN ('-- Transport --','') AND visit_remark != 'Week Off'${visitWhere}
        GROUP BY transport ORDER BY cnt DESC`,
        [date, ...visitParams]).catch(() => []),

      // ── Visit map markers (LATITUDE=lng, LONGITUDE=lat — columns are swapped) ──
      query(`SELECT pan_no,
          CAST(LONGITUDE AS DECIMAL(10,7)) AS lat,
          CAST(LATITUDE  AS DECIMAL(10,7)) AS lng,
          visit_in_location AS location,
          label_in_location AS label,
          TRIM(visit_remark) AS remark,
          transport
        FROM visit_report
        WHERE visit_date = ?
          AND LATITUDE  IS NOT NULL AND LATITUDE  != ''
          AND LONGITUDE IS NOT NULL AND LONGITUDE != ''
          AND CAST(LONGITUDE AS DECIMAL(10,7)) BETWEEN 6  AND 38
          AND CAST(LATITUDE  AS DECIMAL(10,7)) BETWEEN 68 AND 98
          ${visitWhere}
        LIMIT 500`, [date, ...visitParams]).catch(() => []),

      // ── Person-wise visits — uses u.State/u.Branch directly (already joined) ─
      // Cannot reuse visitWhere here: its "pan_no IN (...)" is ambiguous when
      // both visit_report.pan_no and user.pan_no are in scope.
      query(`SELECT v.pan_no,
          u.EMPNAME AS name, u.Branch AS branch, u.State AS state,
          TIME(v.visit_in_time)  AS in_time,
          TIME(v.visit_out_time) AS out_time,
          TIMESTAMPDIFF(MINUTE, v.visit_in_time, v.visit_out_time) AS dur_min,
          v.visit_purpose   AS purpose,
          v.visit_in_location AS location,
          v.label_in_location AS label,
          TRIM(v.visit_remark)  AS remark,
          v.transport,
          CAST(v.LONGITUDE AS DECIMAL(10,7)) AS lat,
          CAST(v.LATITUDE  AS DECIMAL(10,7)) AS lng
        FROM visit_report v
        JOIN \`user\` u ON v.pan_no = u.pan_no
        WHERE v.visit_date = ?
          AND (v.visit_remark IS NULL OR v.visit_remark != 'Week Off')
          ${filterState  && filterState  !== 'All' ? 'AND u.State = ?'  : ''}
          ${filterBranch && filterBranch !== 'All' ? 'AND u.Branch = ?' : ''}
        ORDER BY u.EMPNAME ASC
        LIMIT 2000`,
        [date,
         ...(filterState  && filterState  !== 'All' ? [filterState]  : []),
         ...(filterBranch && filterBranch !== 'All' ? [filterBranch] : []),
        ]).catch(() => []),

      // ── Registered locations (Home / Patrika Office / Other per employee) ───
      query(`SELECT pan_no, location, other_location,
               CAST(latitude  AS DECIMAL(10,7)) AS lat,
               CAST(longitude AS DECIMAL(10,7)) AS lng
             FROM registration_location
             WHERE latitude IS NOT NULL AND latitude != ''
               AND longitude IS NOT NULL AND longitude != ''`).catch(() => []),
    ]);

    // ── GPS label matching against registration_location ──────────────────────
    // A visit within 100 m of a registered spot gets that spot's label.
    // 'Home' spots only match the same employee (pan_no); office/other match anyone.
    const R = 6371000; // earth radius, metres
    const toRad = d => d * Math.PI / 180;
    const distM = (lat1, lng1, lat2, lng2) => {
      const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
      const a = Math.sin(dLat/2)**2 +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };

    const regList = regLocations
      .map(r => ({
        pan:   String(r.pan_no || '').trim().toUpperCase(),
        loc:   String(r.location || '').trim(),
        other: String(r.other_location || '').trim(),
        lat:   Number(r.lat),
        lng:   Number(r.lng),
      }))
      .filter(r => r.lat && r.lng);

    function gpsLabel(panNo, lat, lng) {
      if (lat == null || lng == null) return null;
      const pan = String(panNo || '').trim().toUpperCase();
      let best = null, bestDist = 100; // 100 m threshold
      for (const reg of regList) {
        if (reg.loc.toLowerCase() === 'home' && reg.pan !== pan) continue;
        const d = distM(lat, lng, reg.lat, reg.lng);
        if (d <= bestDist) { bestDist = d; best = reg; }
      }
      if (!best) return null;
      return best.other ? `${best.loc} ${best.other}`.trim() : best.loc;
    }

    // ── Build categories list ─────────────────────────────────────────────────
    const nd = newsDay[0] || {};
    const newsCategories = CAT_KEYS
      .map(([alias, , label]) => ({ name: label, value: Number(nd[alias] || 0) }))
      .filter(c => c.value > 0)
      .sort((a, b) => b.value - a.value);

    const sevMap = {};
    qcBySeverity.forEach(r => { sevMap[r.severity] = Number(r.cnt); });

    // ── Person-wise visits with GPS-matched labels ────────────────────────────
    const personsOut = visitPersons.map(r => {
      const lat = Number(r.lat);
      const lng = Number(r.lng);
      const hasGps = lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98;
      const matched = hasGps ? gpsLabel(r.pan_no, lat, lng) : null;
      return {
        pan_no:   r.pan_no   || '',
        name:     r.name     || '—',
        branch:   r.branch   || '—',
        state:    r.state    || '—',
        in_time:  r.in_time  ? String(r.in_time).slice(0, 5)  : null,
        out_time: r.out_time ? String(r.out_time).slice(0, 5) : null,
        dur_min:  (r.dur_min != null && r.dur_min >= 0) ? Number(r.dur_min) : null,
        purpose:  r.purpose  || '—',
        location: r.location || '',
        label:    matched || '',    // GPS-verified only — self-entered labels are unreliable
        self_label: r.label || '',  // what the reporter claimed, for reference
        label_matched: !!matched,
        remark:   r.remark   || '',
        transport:r.transport|| '',
        lat:      hasGps ? lat : null,
        lng:      hasGps ? lng : null,
      };
    });

    // Home/Office card counts follow the GPS-matched labels so cards and table agree
    const isHome   = l => (l || '').trim().toLowerCase() === 'home';
    const isOffice = l => (l || '').trim().toLowerCase() === 'patrika office';
    const homeCnt   = personsOut.filter(p => isHome(p.label)).length;
    const officeCnt = personsOut.filter(p => isOffice(p.label)).length;

    return res.json({
      date,
      news: {
        summary: {
          reporters: Number(nd.reporters || 0),
          stories:   Number(nd.stories   || 0),
          words:     Number(nd.words     || 0),
          photos:    Number(nd.photos    || 0),
          exclusive: Number(nd.exclusive || 0),
        },
        categories: newsCategories,
        trend: newsTrend.map(r => ({
          date:        r.d ? String(r.d).slice(0, 10) : '',
          stories:     Number(r.stories     || 0),
          words:       Number(r.words       || 0),
          photos:      Number(r.photos      || 0),
          exclusive:   Number(r.exclusive   || 0),
          routine:     Number(r.routine     || 0),
          human_angle: Number(r.human_angle || 0),
          datastory:   Number(r.datastory   || 0),
        })),
      },
      qc: {
        summary: {
          total:    Number((qcSummary[0] || {}).total    || 0),
          mistakes: Number((qcSummary[0] || {}).mistakes || 0),
          high:   sevMap.high   || 0,
          medium: sevMap.medium || 0,
          low:    sevMap.low    || 0,
        },
        by_category: qcByCat.map(r => ({
          category: r.category,
          cnt:      Number(r.cnt),
          mistakes: Number(r.mistakes),
        })),
        recent: qcRecent.map(r => ({
          id:       r.id,
          date:     r.date,
          category: r.category,
          severity: r.severity,
          state:    r.state,
          edition:  r.edition,
          pullout:  r.pullout,
          mistake:  r.mistake,
          mistakes: r.no_of_mistake,
          photo_url:r.photo_url,
        })),
      },
      visits: {
        summary: {
          total:         Number((visitSummary[0] || {}).total    || 0),
          with_loc:      Number((visitSummary[0] || {}).with_loc || 0),
          home_visits:   homeCnt,
          office_visits: officeCnt,
        },
        by_remark:    visitByRemark.map(r   => ({ name: r.remark,    value: Number(r.cnt) })),
        by_transport: visitByTransport.map(r => ({ name: r.transport, value: Number(r.cnt) })),
        markers: visitMarkers.map(r => ({
          lat:      Number(r.lat),
          lng:      Number(r.lng),
          location: r.location || '',
          label:    gpsLabel(r.pan_no, Number(r.lat), Number(r.lng)) || '',
          remark:   r.remark   || '',
          transport:r.transport|| '',
        })),
        persons: personsOut,
      },
    });

  } catch (err) {
    console.error('[pages]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
