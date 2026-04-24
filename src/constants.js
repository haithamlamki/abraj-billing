export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const RIGS = [
  104, 105, 106, 107, 108, 109, 110, 111, 112,
  201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211,
  302, 303, 304, 305,
];

export const RIG_CUST = {
  104: 'PDO', 105: 'Medco', 106: 'PDO', 107: 'PDO', 108: 'PDO', 109: 'PDO',
  110: 'OQ', 111: 'OQ', 112: 'OQ',
  201: 'PDO', 202: 'PDO', 203: 'PDO', 204: 'ARA', 205: 'OQ',
  206: 'OXY', 207: 'OXY', 208: 'OXY', 209: 'OXY',
  210: 'PDO', 211: 'PDO',
  302: 'PDO', 303: 'PDO', 304: 'PDO', 305: 'BP',
};

export const CUST_COLORS = {
  PDO: '#3b82f6',
  OXY: '#f59e0b',
  OQ: '#10b981',
  ARA: '#8b5cf6',
  Medco: '#06b6d4',
  BP: '#ec4899',
};

export const HR_KEYS = [
  'operating', 'reduced', 'breakdown', 'special', 'force_maj',
  'zero_rate', 'standby', 'repair', 'rig_move',
];

export const TARGET_COLS = [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'operating', label: 'Operating', type: 'num' },
  { key: 'reduced', label: 'Reduced', type: 'num' },
  { key: 'breakdown', label: 'Breakdown', type: 'num' },
  { key: 'special', label: 'Special', type: 'num' },
  { key: 'force_maj', label: 'Force Maj', type: 'num' },
  { key: 'zero_rate', label: 'Zero Rate', type: 'num' },
  { key: 'standby', label: 'Standby', type: 'num' },
  { key: 'repair', label: 'Repair', type: 'num' },
  { key: 'rig_move', label: 'Rig Move', type: 'num' },
  { key: 'obm_oper', label: 'OBM Oper', type: 'num' },
  { key: 'obm_red', label: 'OBM Red', type: 'num' },
  { key: 'obm_bd', label: 'OBM BD', type: 'num' },
  { key: 'obm_spe', label: 'OBM Spe', type: 'num' },
  { key: 'obm_zero', label: 'OBM Zero', type: 'num' },
  { key: 'operation', label: 'Operation', type: 'text' },
  { key: 'total_hrs_repair', label: 'Hrs Repair', type: 'num' },
  { key: 'remarks', label: 'Remarks', type: 'text' },
];

export const MAP_GROUPS = {
  essentials: ['date', 'operating', 'total_hrs', 'total_hrs_repair'],
  hours: ['reduced', 'breakdown', 'special', 'force_maj', 'zero_rate', 'standby', 'repair', 'rig_move'],
  obm: ['obm_oper', 'obm_red', 'obm_bd', 'obm_spe', 'obm_zero'],
  text: ['operation', 'remarks'],
};
