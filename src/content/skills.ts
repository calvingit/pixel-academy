import type { Skill, Mapping } from '../learning/models.js';
export const skills: readonly Skill[] = [
  { id: 'math.number.order', subject: 'math', title: '数的顺序与等步长数列' },
  { id: 'math.number.composition', subject: 'math', title: '数的组成与分解' },
  { id: 'math.number.place_value', subject: 'math', title: '数位与数字' },
  { id: 'math.operations.equivalence', subject: 'math', title: '算式结果的比较与等值' },
  { id: 'math.operations.simple_story', subject: 'math', title: '加减数量关系' },
  { id: 'math.number.comparison', subject: 'math', title: '数的大小比较' },
  { id: 'math.addition.missing_addend', subject: 'math', title: '加法中的未知数' },
  {
    "id": "chinese.character.recognition",
    "subject": "chinese",
    "title": "基础汉字识别"
  },
  {
    "id": "chinese.character.meaning",
    "subject": "chinese",
    "title": "字形与字义关联"
  },
  {
    "id": "chinese.pinyin.initials",
    "subject": "chinese",
    "title": "声母辨认"
  },
  {
    "id": "chinese.pinyin.finals",
    "subject": "chinese",
    "title": "韵母辨认"
  },
  {
    "id": "chinese.reading.explicit_information",
    "subject": "chinese",
    "title": "提取明显文本信息"
  },
  {
    "id": "math.number.recognition",
    "subject": "math",
    "title": "数的认识"
  },
  {
    "id": "math.addition.within5",
    "subject": "math",
    "title": "5以内加法"
  },
  {
    "id": "math.subtraction.within5",
    "subject": "math",
    "title": "5以内减法"
  },
  {
    "id": "math.classification.basic",
    "subject": "math",
    "title": "分类与整理"
  },
  {
    "id": "math.addition.within10",
    "subject": "math",
    "title": "10以内加法"
  },
  {
    "id": "math.operations.within100.multistep",
    "subject": "math",
    "title": "100以内多步加减运算"
  },
  {
    "id": "math.measurement.length",
    "subject": "math",
    "title": "长度与测量"
  },
  {
    "id": "math.multiplication.concept",
    "subject": "math",
    "title": "乘法的意义"
  },
  {
    "id": "math.division.equal_sharing",
    "subject": "math",
    "title": "平均分与除法"
  },
  {
    "id": "english.family.members",
    "subject": "english",
    "title": "家庭成员辨认"
  },
  {
    "id": "english.emotions.basic",
    "subject": "english",
    "title": "状态和感受表达"
  },
  {
    "id": "math.geometry.solids",
    "subject": "math",
    "title": "立体图形的认识"
  }
];
export const mappings: readonly Mapping[] = [
  { id: 'MAP-021', skillId: 'math.number.order', unitIds: ['MA-01A-U01'], sourceVerification: 'pending', curriculumVerification: 'pending', evidenceIds: ['handoff-2026-10-25'] },
  { id: 'MAP-022', skillId: 'math.number.order', unitIds: ['MA-02A-U01'], sourceVerification: 'pending', curriculumVerification: 'pending', evidenceIds: ['handoff-2026-10-25'] },
  { id: 'MAP-023', skillId: 'math.number.composition', unitIds: ['MA-01A-U02'], sourceVerification: 'pending', curriculumVerification: 'pending', evidenceIds: ['handoff-2026-10-25'] },
  { id: 'MAP-024', skillId: 'math.number.composition', unitIds: ['MA-02A-U01'], sourceVerification: 'pending', curriculumVerification: 'pending', evidenceIds: ['handoff-2026-10-25'] },
  { id: 'MAP-025', skillId: 'math.number.place_value', unitIds: ['MA-02A-U01'], sourceVerification: 'pending', curriculumVerification: 'pending', evidenceIds: ['handoff-2026-10-25'] },
  { id: 'MAP-026', skillId: 'math.operations.equivalence', unitIds: ['MA-01A-U04'], sourceVerification: 'pending', curriculumVerification: 'pending', evidenceIds: ['handoff-2026-10-25'] },
  { id: 'MAP-027', skillId: 'math.operations.equivalence', unitIds: ['MA-02A-U01'], sourceVerification: 'pending', curriculumVerification: 'pending', evidenceIds: ['handoff-2026-10-25'] },
  { id: 'MAP-028', skillId: 'math.operations.simple_story', unitIds: ['MA-01A-U04'], sourceVerification: 'pending', curriculumVerification: 'pending', evidenceIds: ['handoff-2026-10-25'] },
  { id: 'MAP-029', skillId: 'math.operations.simple_story', unitIds: ['MA-02A-U01'], sourceVerification: 'pending', curriculumVerification: 'pending', evidenceIds: ['handoff-2026-10-25'] },
  { id: 'MAP-017', skillId: 'math.number.comparison', unitIds: ['MA-01A-U01'], sourceVerification: 'pending', curriculumVerification: 'pending', evidenceIds: ['handoff-2026-10-25'] },
  { id: 'MAP-018', skillId: 'math.number.comparison', unitIds: ['MA-02A-U01'], sourceVerification: 'pending', curriculumVerification: 'pending', evidenceIds: ['handoff-2026-10-25'] },
  { id: 'MAP-019', skillId: 'math.addition.missing_addend', unitIds: ['MA-01A-U04'], sourceVerification: 'pending', curriculumVerification: 'pending', evidenceIds: ['handoff-2026-10-25'] },
  { id: 'MAP-020', skillId: 'math.addition.missing_addend', unitIds: ['MA-02A-U01'], sourceVerification: 'pending', curriculumVerification: 'pending', evidenceIds: ['handoff-2026-10-25'] },
  {
    "id": "MAP-001",
    "skillId": "chinese.character.recognition",
    "unitIds": [
      "CH-01A-U01"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-002",
    "skillId": "chinese.character.meaning",
    "unitIds": [
      "CH-01A-U01"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-003",
    "skillId": "chinese.pinyin.initials",
    "unitIds": [
      "CH-01A-U02",
      "CH-01A-U03"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-004",
    "skillId": "chinese.pinyin.finals",
    "unitIds": [
      "CH-01A-U02",
      "CH-01A-U04"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-005",
    "skillId": "chinese.reading.explicit_information",
    "unitIds": [
      "CH-01A-U07"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-006",
    "skillId": "math.number.recognition",
    "unitIds": [
      "MA-01A-U01"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-007",
    "skillId": "math.addition.within5",
    "unitIds": [
      "MA-01A-U02"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-008",
    "skillId": "math.subtraction.within5",
    "unitIds": [
      "MA-01A-U02"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-009",
    "skillId": "math.classification.basic",
    "unitIds": [
      "MA-01A-U03"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-010",
    "skillId": "math.addition.within10",
    "unitIds": [
      "MA-01A-U04"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-011",
    "skillId": "math.operations.within100.multistep",
    "unitIds": [
      "MA-02A-U01"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-012",
    "skillId": "math.measurement.length",
    "unitIds": [
      "MA-02A-U02"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-013",
    "skillId": "math.multiplication.concept",
    "unitIds": [
      "MA-02A-U03"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-014",
    "skillId": "math.division.equal_sharing",
    "unitIds": [
      "MA-02A-U05"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-015",
    "skillId": "english.family.members",
    "unitIds": [
      "EN-01A-U01"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-016",
    "skillId": "english.emotions.basic",
    "unitIds": [
      "EN-01A-U02"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  },
  {
    "id": "MAP-030",
    "skillId": "math.geometry.solids",
    "unitIds": [
      "MA-01A-U05"
    ],
    "sourceVerification": "pending",
    "curriculumVerification": "pending",
    "evidenceIds": [
      "handoff-2026-10-25"
    ]
  }
];
