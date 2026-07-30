/**
 * checklist.seed.ts
 * Seeds all 22 machines + their daily checklists from F-MT-06
 */

import { db } from '../../src/config/database';
import { logger } from '../../src/utils/logger';

const machines = [
  { id: 'MAC000001', code: 'PL-01',   name: 'Pneumatic Loader',     dept: 'MLD', type: 'Loader' },
  { id: 'MAC000002', code: 'PS-01',   name: 'Paint Shop',           dept: 'PNT', type: 'Paint' },
  { id: 'MAC000003', code: 'PB-01',   name: 'Paint Booth',          dept: 'PNT', type: 'Paint' },
  { id: 'MAC000004', code: 'OV-01',   name: 'Oven',                 dept: 'PNT', type: 'Oven' },
  { id: 'MAC000005', code: 'SC-01',   name: 'Scrap Cutter',         dept: 'MLD', type: 'Cutter' },
  { id: 'MAC000006', code: 'WT-01',   name: 'Washing Tank',         dept: 'PNT', type: 'Tank' },
  { id: 'MAC000007', code: 'DT-01',   name: 'Dipping Tank',         dept: 'PNT', type: 'Tank' },
  { id: 'MAC000008', code: 'DH-01',   name: 'De Humidifier',        dept: 'MLD', type: 'Utility' },
  { id: 'MAC000009', code: 'AR-01',   name: 'Air Receiver',         dept: 'MLD', type: 'Utility' },
  { id: 'MAC000010', code: 'BFB-01',  name: 'Buffing Machine',      dept: 'PNT', type: 'Machine' },
  { id: 'MAC000011', code: 'ASU-01',  name: 'Air Supply Unit',      dept: 'MLD', type: 'Utility' },
  { id: 'MAC000012', code: 'SG-01',   name: 'Scrap Grinder',        dept: 'MLD', type: 'Grinder' },
  { id: 'MAC000013', code: 'ADU-01',  name: 'Air Drive Unit',       dept: 'MLD', type: 'Utility' },
  { id: 'MAC000014', code: 'CP-03',   name: 'Air Compressor CP.03', dept: 'MLD', type: 'Compressor' },
  { id: 'MAC000015', code: 'BM-01',   name: 'Molding Machine',      dept: 'MLD', type: 'Moulding' },
  { id: 'MAC000016', code: 'WC-01',   name: 'Water Chiller',        dept: 'MLD', type: 'Utility' },
  { id: 'MAC000017', code: 'DMC-01',  name: 'Drill Machine',        dept: 'MLD', type: 'Machine' },
  { id: 'MAC000018', code: 'DG-01',   name: 'Diesel Generator',     dept: 'MLD', type: 'Generator' },
  { id: 'MAC000019', code: 'LTH-01',  name: 'Lathe Machine',        dept: 'MLD', type: 'Machine' },
  { id: 'MAC000020', code: 'PRS-01',  name: 'Press Machine',        dept: 'MLD', type: 'Machine' },
  { id: 'MAC000021', code: 'CP-01',   name: 'Air Compressor CP.01', dept: 'MLD', type: 'Compressor' },
  { id: 'MAC000022', code: 'TAP-01',  name: 'Tapping Machine',      dept: 'MLD', type: 'Machine' },
];

// Checklist items per machine — Hindi text from Excel
const checklists: Record<string, { items: { text: string; method: string }[] }> = {
  'MAC000001': { items: [
    { text: 'रोज़ाना लोडर की सफाई करें.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या लोडर के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'लोडर की पाइप कही से लूज व कटी हुई नहीं होनी चाहिए.', method: 'A' },
    { text: 'लोडर के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'डिसप्ले टाइमर सही से काम कर रहा होना चाहिए.', method: 'B' },
    { text: 'चलते समय लोडर से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
    { text: 'न्यूमैटिक मैटेरियल लोडर के फ़िल्टर को हर चार घंटे में साफ करें.', method: 'B' },
  ]},
  'MAC000002': { items: [
    { text: 'पेंट शॉप मे फर्श की रोजाना सफाई होनी चाहिए.', method: 'A' },
    { text: 'पेंट शॉप मे पेंट बूथ रोजाना सफाई करें.', method: 'A' },
    { text: 'पेंट शॉप मे ओवरहेड स्थानो को साफ करें. (पाइप्स, एंगल, पैंट बूथ की छत, ओवेन की छत इत्यादि).', method: 'A' },
    { text: 'पेंट शॉप मे फालतू सामान नही होना चाहिए.', method: 'A' },
  ]},
  'MAC000003': { items: [
    { text: 'पेंट बूथ की रोजान सफाई करें.', method: 'A' },
    { text: 'पेंट बूथ की दीवारों को हर चार दिन बाद साफ करें.', method: 'A' },
    { text: '15 दिन मे टेंक का पानी ज़रूर बदलें.', method: 'A' },
    { text: '4 दिन मे फिल्टर की सफाई ज़रूर करें.', method: 'A' },
    { text: 'वॉटर वॉल के पीछे मड स्टोरेज को हर 15 दिन बाद साफ करें.', method: 'A' },
  ]},
  'MAC000004': { items: [
    { text: 'ओवन की रोजान सफाई करें.', method: 'A' },
    { text: 'ओवन की मोटर की बेल्ट लूज़ नही होनी चाहिए.', method: 'A' },
    { text: 'डीजल टॅंक मे डीजल का लेवेल चेक करें.', method: 'A' },
    { text: 'भट्टी के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय भट्टी से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
    { text: 'टाइम डिसप्ले सही होनी चाहिए.', method: 'B' },
  ]},
  'MAC000005': { items: [
    { text: 'कटिंग मशीन की सफाई करें.', method: 'A' },
    { text: 'कटिंग मशीन का ब्लेड लूज़ नही होना चाहिए.', method: 'A' },
    { text: 'कटिंग मशीन की बेल्ट लूज़ नही होनी चाहिए.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या कटिंग मशीन के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'पॉवर स्विच सही स्तिथि में होना चाहिये.', method: 'A' },
    { text: 'कटिंग मशीन के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय कटर से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000006': { items: [
    { text: 'रोज़ाना टेंक की सफाई करें.', method: 'A' },
    { text: '10 दिन टेंक का पानी ज़रूर बदलें.', method: 'A' },
    { text: '10 दिन फिल्टर की सफाई ज़रूर करें.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या मशीन के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'टेंक के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय टेंक से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000007': { items: [
    { text: 'रोज़ाना टेंक की सफाई करें.', method: 'A' },
    { text: '10 दिन मे टेंक का पानी ज़रूर बदलें.', method: 'A' },
    { text: '10 दिन मे फिल्टर की सफाई ज़रूर करें.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या मशीन के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'टेंक के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय टेंक से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000008': { items: [
    { text: 'रोज़ाना मशीन की सफाई करें.', method: 'A' },
    { text: 'मशीन का टेंप्रेचर मीटर चेक करें.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या मशीन के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'मशीन के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय मशीन से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000009': { items: [
    { text: 'रोज़ाना मशीन की सफाई करें.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या मशीन के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'मशीन के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'ऐयर फेन चैक करें.', method: 'B' },
    { text: 'टेंप्रेचर डिसप्ले सही होनी चाहिए.', method: 'B' },
    { text: 'चलते समय मशीन से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000010': { items: [
    { text: 'रोज़ाना मशीन की सफाई करें.', method: 'A' },
    { text: 'मशीन के दोनो पैड को चेक करें.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या मशीन के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'मशीन के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय मशीन से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000011': { items: [
    { text: 'रोज़ाना मशीन की सफाई करें.', method: 'A' },
    { text: 'मशीन के फिन्स को सप्ताह मे एक बार हवा से साफ करे.', method: 'A' },
    { text: 'मशीन मे पानी का लेवल चेक करें.', method: 'A' },
    { text: 'पॉवर स्विच सही स्तिथि में होना चाहिये.', method: 'A' },
    { text: 'मशीन मे फेन की बेल्ट लूज़ नहीं होनी चाहिये.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या मशीन के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'मशीन के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय मशीन से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000012': { items: [
    { text: 'रोज़ाना ग्राइनडिंग मशीन की सफाई करें.', method: 'A' },
    { text: 'ग्राइंडर मे ब्लेड के बोल्ट्स टाइट होने चाहिए.', method: 'A' },
    { text: 'ग्राइंडर की बेल्ट लूज़ नही होनी चाहिए.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या ग्राइनडिंग मशीन के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'पॉवर स्विच सही स्तिथि में होना चाहिये.', method: 'A' },
    { text: 'ग्राइंडर के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय ग्राइंडर से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000013': { items: [
    { text: 'रोज़ाना मशीन की सफाई करें.', method: 'A' },
    { text: 'बिजली के तार कटे-फटे हुये नहीं होने चाहिये.', method: 'A' },
    { text: 'मशीन के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'बाहर के ऐयर फेन को चैक करें.', method: 'B' },
    { text: 'अंदर के ऐयर फेन मे बर्फ जमा नही होनी चाहिए.', method: 'B' },
    { text: 'चलते समय मशीन से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000014': { items: [
    { text: 'रोज़ाना कंप्रेसर की सफाई करें.', method: 'A' },
    { text: 'कंप्रेसर में प्लेट की धूल हवा से हटाएँ.', method: 'A' },
    { text: 'कंप्रेसर के फिल्टर को रोज़ाना साफ करे.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या कंप्रेसर के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'कंप्रेसर के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय कंप्रेसर से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000015': { items: [
    { text: 'रोज़ाना मशीन की सफाई करें.', method: 'A' },
    { text: 'मशीन में तेल और स्नेहक (ल्युब्रिकैंट) चैक करें.', method: 'A' },
    { text: 'स्लाइडिंग नट बोल्ट्स में फ़्री मूव्मेंट होनी चाहिये.', method: 'A' },
    { text: 'हवा का प्रेशर होना चाहिये.', method: 'A' },
    { text: 'मशीन में सही से ग्रीसिंग होनी चाहिये.', method: 'A' },
    { text: 'हाइडरॉलिक प्रेशर होना चाहिये.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या मशीन के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'पॉवर स्विच सही स्तिथि में होना चाहिये.', method: 'A' },
    { text: 'मशीन के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय मशीन से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000016': { items: [
    { text: 'रोज़ाना मशीन की सफाई करें.', method: 'A' },
    { text: 'बिजली के कनैक्शन चैक करें.', method: 'A' },
    { text: 'बिजली के तार कटे-फटे हुये नहीं होने चाहिये.', method: 'A' },
    { text: 'मशीन के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'पानी के टेंक में पानी का लेवल चैक करें.', method: 'A' },
    { text: 'पानी की लीकेज नही होनी चाहिए.', method: 'A' },
    { text: 'रेडियेटर कूलिंग फेन चैक करें व साफ करें.', method: 'B' },
    { text: 'चलते समय मशीन से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000017': { items: [
    { text: 'रोज़ाना मशीन की सफाई करें.', method: 'A' },
    { text: 'मशीन में सही से ग्रीसिंग होनी चाहिये.', method: 'A' },
    { text: 'स्पिन्डल में फ़्री मूव्मेंट होनी चाहिये.', method: 'A' },
    { text: 'चक कसा हुआ होना चाहिये.', method: 'A' },
    { text: 'स्पिन्डल व्हील सही से काम करना चाहिये.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या मशीन के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'पॉवर स्विच सही स्तिथि में होना चाहिये.', method: 'A' },
    { text: 'मशीन के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय मशीन से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
    { text: 'सबसे पहले एक पीस क्वालिटी ईंस्पैक्टर से चैक कराये.', method: 'B' },
  ]},
  'MAC000018': { items: [
    { text: 'जेनेरेटर के चारों तरफ साफ सफाई होनी चाहिये.', method: 'A' },
    { text: 'रेडियेटर में पानी चैक करें (कैप खोल कर देखें) पानी पूरा भरा होना चाहिये.', method: 'A' },
    { text: 'ईंजन का ऑयल गेज से चैक करें.', method: 'A' },
    { text: 'डीजल का लैवल चैक करें.', method: 'A' },
    { text: 'ऑयल का पाईप चैक करें, इसमें कोई लीकेज नहीं चाहिये.', method: 'A' },
    { text: 'रेडियेटर, सैल्फ और डायनैमो की बैल्ट चैक करें.', method: 'A' },
    { text: 'जेनेरेटर के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'बैटरी के पानी का लैवल, हर हफ्ते चैक करें.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था नहीं होनी चहिये.', method: 'A' },
    { text: 'जेनेरेटर से दो फीट की दूरी पर कोई वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय जेनेरेटर से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000019': { items: [
    { text: 'मशीन स्वच्छ और साफ होनी चाहिये.', method: 'A' },
    { text: 'मशीन में तेल और स्नेहक (ल्युब्रिकैंट) चैक करें.', method: 'A' },
    { text: 'स्पिन्डल में फ़्री मूव्मेंट होनी चाहिये.', method: 'A' },
    { text: 'चक कसा हुआ होना चाहिये.', method: 'A' },
    { text: 'मशीन में सही से ग्रीसिंग होनी चाहिये.', method: 'A' },
    { text: 'टेबल सही हाईट पर होनी चाहिये.', method: 'A' },
    { text: 'स्पिन्डल व्हील सही से काम करना चाहिये.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या मशीन के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'पॉवर स्विच सही स्तिथि में होना चाहिये.', method: 'A' },
    { text: 'मशीन के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय मशीन से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000020': { items: [
    { text: 'मशीन स्वच्छ और साफ होनी चाहिये.', method: 'A' },
    { text: 'मशीन में तेल और स्नेहक (ल्युब्रिकैंट) चैक करें.', method: 'A' },
    { text: 'बोल्ट और चाबियाँ कसी हुई होनी चाहिये.', method: 'A' },
    { text: 'स्लाईड के बोल्ट चैक करें.', method: 'A' },
    { text: 'पंच सही स्तिथि में होना चाहिये.', method: 'A' },
    { text: 'मशीन के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या मशीन के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'पॉवर स्विच सही स्तिथि में होना चाहिये.', method: 'A' },
    { text: 'पैडल सही स्तिथि में होना चाहिये.', method: 'A' },
    { text: 'मीटर चालू (ऑन) होना चाहिये.', method: 'A' },
    { text: 'मशीन से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
    { text: 'सबसे पहले एक पीस क्वालिटी ईंस्पैक्टर से चैक कराये.', method: 'B' },
  ]},
  'MAC000021': { items: [
    { text: 'रोज़ाना कंप्रेसर की सफाई करें.', method: 'A' },
    { text: 'कंप्रेसर में आयल लेवल चैक करें.', method: 'A' },
    { text: 'कंप्रेसर के फिल्टर को रोज़ाना हवा से साफ करे.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या कंप्रेसर के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'कंप्रेसर के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय कंप्रेसर से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
  ]},
  'MAC000022': { items: [
    { text: 'मशीन स्वच्छ और साफ होनी चाहिये.', method: 'A' },
    { text: 'मशीन में तेल और स्नेहक (ल्युब्रिकैंट) चैक करें.', method: 'A' },
    { text: 'स्पिन्डल में फ़्री मूव्मेंट होनी चाहिये.', method: 'A' },
    { text: 'चक कसा हुआ होना चाहिये.', method: 'A' },
    { text: 'मशीन में सही से ग्रीसिंग होनी चाहिये.', method: 'A' },
    { text: 'टेबल सही हाईट पर होनी चाहिये.', method: 'A' },
    { text: 'बिजली की तार कटी-फटी अवस्था में या मशीन के किसी पार्ट से उलझी हुई नहीं होनी चहिये.', method: 'A' },
    { text: 'पॉवर स्विच सही स्तिथि में होना चाहिये.', method: 'A' },
    { text: 'मशीन के ऊपर कोई अनावश्यक वस्तु नहीं होनी चाहिये.', method: 'A' },
    { text: 'चलते समय मशीन से कोई अनावश्यक आवाज नहीं आनी चाहिये.', method: 'B' },
    { text: 'सबसे पहले एक पीस क्वालिटी ईंस्पैक्टर से चैक कराये.', method: 'B' },
  ]},
};

// Dept code → dept_id mapping
const deptMap: Record<string, string> = {
  'MLD': 'DEP009', // Moulding
  'PNT': 'DEP002', // Paint Shop
};

export async function seedChecklists(): Promise<void> {
  logger.info('🌱 Seeding machines and checklists...');

  let macCount = 0;
  let tplCount = 0;
  let itmCount = 0;

  // Get current counters
  const [macRows] = await db.execute<any>(`SELECT value FROM settings WHERE key = 'COUNTER_MAC'`);
  const [tplRows] = await db.execute<any>(`SELECT value FROM settings WHERE key = 'COUNTER_TMP'`);
  const [itmRowsCnt] = await db.execute<any>(`SELECT value FROM settings WHERE key = 'COUNTER_ITM'`);

  let macCounter = parseInt((macRows as any[])[0]?.value || '0');
  let tplCounter = parseInt((tplRows as any[])[0]?.value || '0');
  let itmCounter = parseInt((itmRowsCnt as any[])[0]?.value || '0');

  for (const machine of machines) {
    const deptId = deptMap[machine.dept] || 'DEP009';

    // Insert machine
    await db.query(
      `INSERT INTO machines (machine_id, machine_name, machine_code, dept_id, machine_type, status, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, 'Active', true, 'USR000001')
       ON CONFLICT (machine_id) DO NOTHING`,
      [machine.id, machine.name, machine.code, deptId, machine.type]
    );
    macCounter++;
    macCount++;

    // Create daily checklist template for this machine
    tplCounter++;
    const tplId = `TMP${String(tplCounter).padStart(6, '0')}`;
    await db.query(
      `INSERT INTO checklist_templates 
        (template_id, template_name, dept_id, frequency, has_photo, description, is_active, created_by)
       VALUES ($1, $2, $3, 'Daily', false, $4, true, 'USR000001')
       ON CONFLICT (template_id) DO NOTHING`,
      [tplId, `Daily Check - ${machine.name}`, deptId, `F/MT/06 Daily Machine Check Sheet for ${machine.name}`]
    );
    tplCount++;

    // Insert checklist items
    const items = checklists[machine.id]?.items || [];
    for (let i = 0; i < items.length; i++) {
      itmCounter++;
      const itmId = `ITM${String(itmCounter).padStart(6, '0')}`;
      const item = items[i];
      await db.query(
        `INSERT INTO checklist_items
          (item_id, template_id, item_text, input_type, is_mandatory, sort_order, is_active)
         VALUES ($1, $2, $3, 'OkNotOk', true, $4, true)
         ON CONFLICT (item_id) DO NOTHING`,
        [itmId, tplId, item.text, i + 1]
      );
      itmCount++;
    }

    // Assign template to machine
    const mapId = `MAP${String(tplCounter).padStart(6, '0')}`;
    await db.query(
      `INSERT INTO machine_template_map
        (map_id, machine_id, template_id, is_active, schedule_start_date, assigned_by)
       VALUES ($1, $2, $3, true, CURRENT_DATE, 'USR000001')
       ON CONFLICT (machine_id, template_id) DO NOTHING`,
      [mapId, machine.id, tplId]
    );

    logger.info(`  ✅ ${machine.name} — ${items.length} checks`);
  }

  // Update counters
  await db.query(`UPDATE settings SET value = $1 WHERE key = 'COUNTER_MAC'`, [macCounter.toString()]);
  await db.query(`UPDATE settings SET value = $1 WHERE key = 'COUNTER_TMP'`, [tplCounter.toString()]);
  await db.query(`UPDATE settings SET value = $1 WHERE key = 'COUNTER_ITM'`, [itmCounter.toString()]);

  logger.info(`✅ Machines seeded: ${macCount}`);
  logger.info(`✅ Templates created: ${tplCount}`);
  logger.info(`✅ Checklist items: ${itmCount}`);
}
