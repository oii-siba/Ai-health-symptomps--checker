from flask import Flask, request, jsonify, send_from_directory
import os
import sqlite3
import json
import random
import datetime

app = Flask(__name__, static_folder='.', static_url_path='')

@app.before_request
def handle_options_preflight():
    if request.method == 'OPTIONS':
        response = app.make_default_options_response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
        response.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
        return response

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
    return response

DATABASE_FILE = 'aegis_health.db'

# In-memory report cache so prescription page works even before explicit DB save
_report_cache = {}

# Check if image packages are installed for advanced tissue checker
try:
    from PIL import Image
    import numpy as np
    HAS_IMAGE_LIBS = True
except ImportError:
    HAS_IMAGE_LIBS = False

def get_db():
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        # 1. User Profile table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                name TEXT,
                age INTEGER,
                gender TEXT,
                avatar TEXT,
                weight REAL,
                height REAL,
                blood_group TEXT,
                allergies TEXT,
                medical_history TEXT,
                location TEXT
            )
        ''')
        try:
            conn.execute("ALTER TABLE profile ADD COLUMN location TEXT")
        except sqlite3.OperationalError:
            pass

        # Insert default profile if not exists
        conn.execute('''
            INSERT OR IGNORE INTO profile (id, name, age, gender, avatar, weight, height, blood_group, allergies, medical_history, location)
            VALUES (1, 'Sarah Jenkins', 28, 'Female', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=256', 62.0, 168.0, 'A+', 'Peanuts, Penicillin', 'Mild Asthma in childhood', 'San Francisco')
        ''')
        
        # 2. Medications table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS medications (
                id TEXT PRIMARY KEY,
                name TEXT,
                dose TEXT,
                time TEXT,
                taken_today INTEGER,
                last_taken_date TEXT
            )
        ''')
        # Insert default medications if table is empty
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM medications")
        if cur.fetchone()[0] == 0:
            conn.execute("INSERT INTO medications VALUES ('m1', 'Atorvastatin', '10mg Tablet', '21:00', 0, '')")
            conn.execute("INSERT INTO medications VALUES ('m2', 'Metformin', '500mg Capsule', '08:30', 0, '')")
            
        # 3. Water log table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS water_log (
                date TEXT PRIMARY KEY,
                current INTEGER,
                target INTEGER
            )
        ''')
        
        # 4. Sleep logs table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS sleep_logs (
                id TEXT PRIMARY KEY,
                bedtime TEXT,
                waketime TEXT,
                quality INTEGER,
                duration REAL,
                date TEXT
            )
        ''')
        # Insert default sleep logs if empty
        cur.execute("SELECT COUNT(*) FROM sleep_logs")
        if cur.fetchone()[0] == 0:
            conn.execute("INSERT INTO sleep_logs VALUES ('s1', '22:30', '07:00', 4, 8.5, 'Jul 6, 2026')")
            conn.execute("INSERT INTO sleep_logs VALUES ('s2', '23:00', '06:30', 3, 7.5, 'Jul 5, 2026')")
            
        # 5. Diagnostics history table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS diagnostics_history (
                id TEXT PRIMARY KEY,
                report_json TEXT
            )
        ''')
        conn.commit()

# --- ROUTES ---

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

# --- PROFILE API ---
@app.route('/api/profile', methods=['GET', 'POST'])
def profile_api():
    if request.method == 'GET':
        conn = get_db()
        row = conn.execute('SELECT * FROM profile WHERE id = 1').fetchone()
        conn.close()
        return jsonify(dict(row))
    else:
        data = request.json
        conn = get_db()
        conn.execute('''
            UPDATE profile SET 
                name = ?, age = ?, gender = ?, avatar = ?,
                weight = ?, height = ?, blood_group = ?,
                allergies = ?, medical_history = ?, location = ?
            WHERE id = 1
        ''', (
            data.get('name'), data.get('age'), data.get('gender'), data.get('avatar'),
            data.get('weight'), data.get('height'), data.get('bloodGroup'),
            data.get('allergies'), data.get('medicalHistory'), data.get('location')
        ))
        conn.commit()
        row = conn.execute('SELECT * FROM profile WHERE id = 1').fetchone()
        conn.close()
        return jsonify(dict(row))

# --- MEDICATIONS API ---
@app.route('/api/medications', methods=['GET', 'POST'])
def medications_api():
    conn = get_db()
    if request.method == 'GET':
        rows = conn.execute('SELECT * FROM medications').fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])
    else:
        data = request.json
        conn.execute('''
            INSERT OR REPLACE INTO medications (id, name, dose, time, taken_today, last_taken_date)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            data.get('id'), data.get('name'), data.get('dose'), data.get('time'),
            data.get('takenToday', 0), data.get('lastTakenDate', '')
        ))
        conn.commit()
        rows = conn.execute('SELECT * FROM medications').fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])

@app.route('/api/medications/<med_id>', methods=['DELETE'])
def delete_medication(med_id):
    conn = get_db()
    conn.execute('DELETE FROM medications WHERE id = ?', (med_id,))
    conn.commit()
    rows = conn.execute('SELECT * FROM medications').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

# --- WATER HYDRATION API ---
@app.route('/api/water', methods=['GET', 'POST'])
def water_api():
    conn = get_db()
    if request.method == 'GET':
        date_str = request.args.get('date')
        row = conn.execute('SELECT * FROM water_log WHERE date = ?', (date_str,)).fetchone()
        conn.close()
        if row:
            return jsonify(dict(row))
        else:
            return jsonify({'date': date_str, 'current': 0, 'target': 2000})
    else:
        data = request.json
        conn.execute('''
            INSERT OR REPLACE INTO water_log (date, current, target)
            VALUES (?, ?, ?)
        ''', (data.get('date'), data.get('current'), data.get('target', 2000)))
        conn.commit()
        row = conn.execute('SELECT * FROM water_log WHERE date = ?', (data.get('date'),)).fetchone()
        conn.close()
        return jsonify(dict(row))

@app.route('/api/water/reset', methods=['POST'])
def reset_water():
    data = request.json
    conn = get_db()
    conn.execute('UPDATE water_log SET current = 0 WHERE date = ?', (data.get('date'),))
    conn.commit()
    row = conn.execute('SELECT * FROM water_log WHERE date = ?', (data.get('date'),)).fetchone()
    conn.close()
    return jsonify(dict(row))

# --- SLEEP API ---
@app.route('/api/sleep', methods=['GET', 'POST'])
def sleep_api():
    conn = get_db()
    if request.method == 'GET':
        rows = conn.execute('SELECT * FROM sleep_logs ORDER BY date DESC').fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])
    else:
        data = request.json
        conn.execute('''
            INSERT INTO sleep_logs (id, bedtime, waketime, quality, duration, date)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            data.get('id'), data.get('bedtime'), data.get('waketime'),
            data.get('quality'), data.get('duration'), data.get('date')
        ))
        conn.commit()
        rows = conn.execute('SELECT * FROM sleep_logs ORDER BY date DESC').fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])

# --- CLINICAL RISK PREDICTION API ---
@app.route('/api/predict-risk', methods=['POST'])
def predict_risk():
    data = request.json
    systolic = int(data.get('systolic', 120))
    exercise = int(data.get('exercise', 3))
    is_smoker = bool(data.get('isSmoker', False))
    is_diabetic = bool(data.get('isDiabetic', False))
    is_heart_history = bool(data.get('isHeartHistory', False))
    is_alcohol = bool(data.get('isAlcohol', False))
    lang = data.get('lang', 'en')
    
    cardio_risk = 5
    diabetes_risk = 4
    hyper_risk = 8
    
    if systolic > 140:
        hyper_risk += 40
        cardio_risk += 25
    elif systolic > 120:
        hyper_risk += 15
        cardio_risk += 10
        
    if exercise >= 7:
        cardio_risk -= 3
        diabetes_risk -= 3
        hyper_risk -= 4
    elif exercise < 2:
        cardio_risk += 8
        diabetes_risk += 10
        hyper_risk += 8
        
    if is_smoker:
        cardio_risk += 30
        hyper_risk += 15
    if is_diabetic:
        diabetes_risk += 35
        cardio_risk += 12
    if is_heart_history:
        cardio_risk += 20
        hyper_risk += 10
    if is_alcohol:
        hyper_risk += 12
        cardio_risk += 8
        
    cardio_risk = min(99, max(2, cardio_risk))
    diabetes_risk = min(99, max(1, diabetes_risk))
    hyper_risk = min(99, max(3, hyper_risk))
    
    max_risk = max(cardio_risk, diabetes_risk, hyper_risk)
    
    advice = ""
    if max_risk > 45:
        if lang == 'bn':
            advice = "আপনার ঝুঁকি উচ্চ সীমায় রয়েছে। ধূমপান বর্জন করুন, রক্তচাপ নিয়মিত পরীক্ষা করুন এবং ডাক্তারের পরামর্শ নিন।"
        elif lang == 'hi':
            advice = "आपका जोखिम स्तर अधिक है। धूम्रपान बंद करें, रक्तचाप की नियमित जांच कराएं और डॉक्टर से मिलें।"
        else:
            advice = "High clinical indicators observed. Avoid active tobacco smoking, maintain 150 minutes of weekly cardio exercise, and schedule medical physical evaluations."
    elif max_risk > 20:
        if lang == 'bn':
            advice = "মাঝারি ঝুঁকি সনাক্ত হয়েছে। জীবনযাত্রার মান উন্নত করতে ব্যায়াম বাড়ান এবং সোডিয়াম কমান।"
        elif lang == 'hi':
            advice = "मध्यम जोखिम का पता चला है। जीवनशैली में सुधार के लिए व्यायाम बढ़ाएं और नमक का सेवन कम करें।"
        else:
            advice = "Borderline risks. Increase daily active walking, decrease dietary sodium intake, and schedule routine preventive wellness screenings."
    else:
        if lang == 'bn':
            advice = "আপনার ঝুঁকি অনেক কম। সুষম খাদ্য এবং স্বাস্থ্যকর জীবনযাত্রা বজায় রাখুন।"
        elif lang == 'hi':
            advice = "आपका जोखिम स्तर बहुत कम है। संतुलित आहार और स्वस्थ जीवनशैली बनाए रखें।"
        else:
            advice = "Low risk metrics. Continue maintaining healthy habits, routine exercises, and balanced diet profiles."
            
    return jsonify({
        'cardioRisk': cardio_risk,
        'diabetesRisk': diabetes_risk,
        'hyperRisk': hyper_risk,
        'maxRisk': max_risk,
        'advice': advice
    })

# --- SKIN ANALYSIS API ---
SKIN_CONDITIONS = [
    {
        "name": "Atopic Dermatitis (Eczema)",
        "name_bn": "অ্যাটোপিক ডার্মাটাইটিস (একজিমা)",
        "name_hi": "एटोपिक डर्मेटाइटिस (एक्जिमा)",
        "pct": 92,
        "warning": False,
        "desc": "An inflammatory skin condition causing dry, red, and extremely itchy patches, common in joint creases.",
        "desc_bn": "একটি প্রদাহজনক ত্বকের অবস্থা যা শুষ্ক, লাল এবং অত্যন্ত চুলকানিযুক্ত দাগ সৃষ্টি করে, সাধারণত জয়েন্টগুলিতে হয়।",
        "desc_hi": "एक सूजनयुक्त त्वचा की स्थिति जो सूखी, लाल और अत्यधिक खुजली वाले पैच का कारण बनती है, जोड़ों की सिलवटों में आम है।",
        "care": [
            "Moisturize skin twice daily with thick, fragrance-free creams.",
            "Avoid harsh soaps, hot water, and sudden temperature shifts.",
            "Use cold compresses to alleviate acute itching fits.",
            "Avoid wool clothing and environmental allergens."
        ],
        "care_bn": [
            "সুগন্ধিমুক্ত ঘন ক্রিম দিয়ে দিনে দুবার ত্বক ময়শ্চারাইজ করুন।",
            "কড়া সাবান, গরম জল এবং হঠাৎ তাপমাত্রা পরিবর্তন এড়িয়ে চলুন।",
            "চুলকানি কমাতে ঠান্ডা সেঁক ব্যবহার করুন।",
            "পশমী কাপড় এবং পরিবেশগত অ্যালার্জেন এড়িয়ে চলুন।"
        ],
        "care_hi": [
            "खुशबू रहित गाढ़ी क्रीम से दिन में दो बार त्वचा को मॉइस्चराइज करें।",
            "कठोर साबुन, गर्म पानी और अचानक तापमान परिवर्तन से बचें।",
            "तीव्र खुजली से राहत पाने के लिए ठंडी सिकाई का प्रयोग करें।",
            "ऊनी कपड़ों और पर्यावरणीय एलर्जी कारकों से बचें।"
        ]
    },
    {
        "name": "Acne Vulgaris",
        "name_bn": "অ্যাকনি ভালগারিস (ব্রণ)",
        "name_hi": "एक्ने वल्गेरिस (मुँहासे)",
        "pct": 88,
        "warning": False,
        "desc": "A common skin condition occurring when hair follicles become clogged with oil and dead skin cells.",
        "desc_bn": "একটি সাধারণ ত্বকের অবস্থা যা ঘটে যখন লোমকূপ তেল এবং ত্বকের মৃত কোষ দ্বারা অবরুদ্ধ হয়ে যায়।",
        "desc_hi": "एक आम त्वचा की स्थिति जो तब होती है जब बालों के रोम तेल और मृत त्वचा कोशिकाओं से बंद हो जाते हैं।",
        "care": [
            "Cleanse face gently twice daily with a mild salicylic acid cleanser.",
            "Avoid picking, squeezing, or popping acne lesions.",
            "Use non-comedogenic (pore-friendly) moisturizers and sunscreen.",
            "Limit intake of high-glycemic foods and dairy products."
        ],
        "care_bn": [
            "মৃদু স্যালিসিলিক অ্যাসিড ক্লিনজার দিয়ে দিনে দুবার মুখ হালকাভাবে পরিষ্কার করুন।",
            "ব্রণ খোঁটা বা ফাটানো এড়িয়ে চলুন।",
            "নন-কমেডোজেনিক ময়শ্চারাইজার এবং সানস্ক্রিন ব্যবহার করুন।",
            "মিষ্টি খাবার এবং দুগ্ধজাত খাবারের ব্যবহার সীমিত করুন।"
        ],
        "care_hi": [
            "सौम्य सैलिसिलिक एसिड क्लींजर से दिन में दो बार चेहरा धोएं।",
            "मुँहासों को नोचने या दबाने से बचें।",
            "गैर-कॉमेडोजेनिक (रोमछिद्रों के अनुकूल) मॉइस्चराइज़र और सनस्क्रीन का उपयोग करें।",
            "उच्च ग्लाइसेमिक खाद्य पदार्थों और डेयरी उत्पादों का सेवन सीमित करें।"
        ]
    },
    {
        "name": "Plaque Psoriasis",
        "name_bn": "প্লেক সোরিয়াসিস",
        "name_hi": "प्लेक सोरायसिस",
        "pct": 84,
        "warning": True,
        "desc": "An autoimmune disease causing rapid buildup of skin cells, leading to scaly, silvery plaques.",
        "desc_bn": "একটি অটোইমিউন রোগ যা ত্বকের কোষগুলির দ্রুত বৃদ্ধির কারণে আঁশযুক্ত, রূপালী রঙের প্লাক তৈরি করে।",
        "desc_hi": "एक ऑटोइम्यून बीमारी जो त्वचा कोशिकाओं के तेजी से निर्माण का कारण बनती है, जिससे पपड़ीदार, चांदी जैसे धब्बे बन जाते हैं।",
        "care": [
            "Keep skin hydrated with ointment-based barrier repairs.",
            "Expose skin to brief sessions of natural sunlight daily.",
            "Avoid stress triggers and alcohol which trigger flare-ups.",
            "Consult a dermatologist for topical corticosteroid options."
        ],
        "care_bn": [
            "মলম-ভিত্তিক ক্রিম দিয়ে ত্বক হাইড্রেটেড রাখুন।",
            "প্রতিদিন কিছুক্ষণ স্বাভাবিক সূর্যালোকের সংস্পর্শে থাকুন।",
            "মানসিক চাপ এবং অ্যালকোহল এড়িয়ে চলুন যা এটি বাড়িয়ে দেয়।",
            "টপিকাল কর্টিকোস্টেরয়েড চিকিৎসার জন্য চর্মরোগ বিশেষজ্ঞের পরামর্শ নিন।"
        ],
        "care_hi": [
            "मलहम-आधारित क्रीम से त्वचा को हाइड्रेटेड रखें।",
            "प्रतिदिन प्राकृतिक धूप के संपर्क में थोड़ी देर रहें।",
            "तनाव और शराब से बचें जो इसके लक्षणों को बढ़ाते हैं।",
            "सामयिक कॉर्टिकोस्टेरॉइड विकल्पों के लिए त्वचा रोग विशेषज्ञ से परामर्श लें।"
        ]
    },
    {
        "name": "Malignant Melanoma Indicator",
        "name_bn": "ম্যালিগন্যান্ট মেলানোমা ইন্ডিকেটর",
        "name_hi": "घातक मेलेनोमा संकेतक",
        "pct": 74,
        "warning": True,
        "desc": "Suspicious asymmetrical pigmented lesion with irregular borders. Immediate clinical biopsy advised.",
        "desc_bn": "অনিয়মিত সীমানা সহ সন্দেহজনক অসমমিত রঙ্গক ক্ষত। অবিলম্বে ক্লিনিকাল বায়োপসি করার পরামর্শ দেওয়া হচ্ছে।",
        "desc_hi": "अनियमित सीमाओं के साथ संदिग्ध असममित रंगद्रव्य घाव। तत्काल नैदानिक बायोप्सी की सलाह दी जाती है।",
        "care": [
            "Do not apply self-treatment or scratch the lesion area.",
            "Schedule an urgent clinical screening with a dermatologist.",
            "Protect the skin area from direct sunlight using SPF 50+.",
            "Take high-resolution photos with a ruler to track size changes."
        ],
        "care_bn": [
            "ক্ষত স্থানে নিজে থেকে কোনো চিকিৎসা বা চুলকানি করবেন না।",
            "চর্মরোগ বিশেষজ্ঞের সাথে অবিলম্বে অ্যাপয়েন্টমেন্ট নির্ধারণ করুন।",
            "SPF 50+ ব্যবহার করে এলাকাটি সরাসরি সূর্যালোক থেকে রক্ষা করুন।",
            "আকার পরিবর্তন ট্র্যাক করতে স্কেল বা রুলার সহ উচ্চ-রেজোলিউশন ফটো নিন।"
        ],
        "care_hi": [
            "खुद से कोई उपचार न करें और न ही घाव वाली जगह को खुजलाएं।",
            "त्वचा विशेषज्ञ के साथ तत्काल नैदानिक जांच का समय निर्धारित करें।",
            "SPF 50+ का उपयोग करके त्वचा क्षेत्र को सीधी धूप से बचाएं।",
            "आकार में बदलाव को ट्रैक करने के लिए रूलर के साथ उच्च-रिज़ॉल्यूशन फ़ोटो लें।"
        ]
    }
]

@app.route('/api/analyze-skin', methods=['POST'])
def analyze_skin():
    if 'image' not in request.files:
        return jsonify({'error': 'No image file uploaded'}), 400
        
    image_file = request.files['image']
    
    # Run the skin check algorithm on the backend using YCbCr + HSV
    has_skin = True
    if HAS_IMAGE_LIBS:
        try:
            image_file.seek(0)
            img = Image.open(image_file).convert('RGB')
            img.thumbnail((120, 120)) # resize for performance
            arr = np.array(img)
            
            ycbcr_arr = np.array(img.convert('YCbCr'))
            hsv_arr = np.array(img.convert('HSV'))
            
            r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
            y, cb, cr = ycbcr_arr[:, :, 0], ycbcr_arr[:, :, 1], ycbcr_arr[:, :, 2]
            h, s, v = hsv_arr[:, :, 0], hsv_arr[:, :, 1], hsv_arr[:, :, 2]
            
            # Calibrated YCbCr Rule: expanded Cr upper bound for inflamed red skin rashes, Cb/Y limits
            is_skin_ycbcr = (cb >= 70) & (cb <= 135) & (cr >= 130) & (cr <= 200) & (y >= 30)
            
            # Calibrated HSV Rule: Hue in red-orange-yellow range [-30, 28] -> [0, 28] or [230, 255], Saturation/Value limits
            is_skin_hsv = ((h <= 28) | (h >= 230)) & (s >= 20) & (s <= 180) & (v >= 30)
            
            is_skin = is_skin_ycbcr & is_skin_hsv
            
            skin_ratio = np.sum(is_skin) / is_skin.size
            print(f"Skin validation ratio: {skin_ratio:.4f}")
            
            # Require at least 15% of the pixels to match skin tone criteria
            has_skin = skin_ratio > 0.15
            
            # Reject high-texture non-skin patterns (like fur, carpet, wood grain) or uniform blocks
            if has_skin:
                gray = 0.299 * r + 0.587 * g + 0.114 * b
                skin_pixels = gray[is_skin]
                if len(skin_pixels) > 100:
                    skin_std = np.std(skin_pixels)
                    # Compute gradients manually in numpy
                    dx = gray[1:, :-1] - gray[:-1, :-1]
                    dy = gray[:-1, 1:] - gray[:-1, :-1]
                    grad = np.sqrt(dx**2 + dy**2)
                    skin_grad = grad[is_skin[:-1, :-1]]
                    mean_grad = np.mean(skin_grad) if len(skin_grad) > 0 else 0
                    
                    print(f"Skin texture metrics - Std: {skin_std:.2f}, Mean Grad: {mean_grad:.2f}")
                    if skin_std > 55.0 or mean_grad > 22.0 or skin_std < 1.0:
                        has_skin = False
                        print(f"Rejected due to texture check.")
        except Exception as e:
            print("Skin validation error on server:", e)
            has_skin = True
            
    if not has_skin:
        return jsonify({'success': False, 'error': 'no_skin_detected'}), 200
        
    # Return a diagnostic skin condition based on the image analysis
    condition = random.choice(SKIN_CONDITIONS)
    if HAS_IMAGE_LIBS and has_skin:
        try:
            total_skin = np.sum(is_skin)
            if total_skin > 0:
                dark_ratio = np.sum((v < 110) & (s > 25) & is_skin) / total_skin
                bright_ratio = np.sum((v > 185) & (s < 70) & is_skin) / total_skin
                red_ratio = np.sum((r.astype(int) - g.astype(int) > 55) & is_skin) / total_skin
                
                print(f"Skin diagnosis features - Dark: {dark_ratio:.4f}, Bright: {bright_ratio:.4f}, Red: {red_ratio:.4f}")
                
                if dark_ratio > 0.04:
                    condition = SKIN_CONDITIONS[3] # Malignant Melanoma Indicator
                elif bright_ratio > 0.08 and red_ratio > 0.10:
                    condition = SKIN_CONDITIONS[2] # Plaque Psoriasis
                elif red_ratio > 0.12:
                    condition = SKIN_CONDITIONS[0] # Atopic Dermatitis (Eczema)
                else:
                    condition = SKIN_CONDITIONS[1] # Acne Vulgaris
        except Exception as diag_e:
            print("Error in skin diagnosis heuristic:", diag_e)
            
    return jsonify({
        'success': True,
        'condition': condition
    })

# --- BLOOD ANALYSIS API ---
BLOOD_BIOMARKERS_MOCK = [
    { 'name': 'Hemoglobin', 'value': 11.2, 'ref': '12.0 - 15.5 g/dL', 'status': 'low' },
    { 'name': 'White Blood Cell (WBC)', 'value': 8.4, 'ref': '4.5 - 11.0 x10^3/uL', 'status': 'normal' },
    { 'name': 'Cholesterol (Total)', 'value': 245, 'ref': '< 200 mg/dL', 'status': 'high' },
    { 'name': 'Fasting Blood Glucose', 'value': 92, 'ref': '70 - 99 mg/dL', 'status': 'normal' },
    { 'name': 'Platelets Count', 'value': 280, 'ref': '150 - 450 x10^3/uL', 'status': 'normal' }
]

def validate_blood_report(file):
    filename = file.filename.lower()
    
    # Check file extension
    ext = filename.split('.')[-1] if '.' in filename else ''
    
    # 1. If it is a text-based format, check content keywords
    if ext in ['txt', 'csv', 'tsv', 'json']:
        try:
            content = file.read().decode('utf-8', errors='ignore').lower()
            file.seek(0) # reset stream
            keywords = ["blood", "report", "lab", "test", "cbc", "wbc", "rbc", "cholesterol", "glucose", "platelet", "hemoglobin", "ref", "range", "mg/dl", "ul", "count", "value", "status"]
            matches = sum(1 for kw in keywords if kw in content)
            if matches >= 2:
                return True
            return False
        except Exception:
            return True
            
    # 2. If it is an image, check layout and text contours using OpenCV
    if ext in ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff']:
        try:
            import cv2
            
            # Read image bytes
            img_bytes = file.read()
            file.seek(0) # reset stream
            
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return False
                
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
            # Check light background ratio: reports are mostly white/light gray
            h, w = gray.shape
            total_pixels = h * w
            if total_pixels == 0:
                return False
                
            light_pixels = np.sum(gray > 170)
            light_ratio = light_pixels / total_pixels
            print(f"Blood report validation - Light ratio: {light_ratio:.4f}")
            
            # Binarize to find text contours
            _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            
            # Find contours
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            # Count small text-like contours
            text_contour_count = 0
            for cnt in contours:
                x, y, w_c, h_c = cv2.boundingRect(cnt)
                # Typical letter dimensions in a standard report image
                if 2 <= w_c <= 80 and 4 <= h_c <= 80:
                    text_contour_count += 1
                    
            print(f"Blood report validation - Text-like contours: {text_contour_count}")
            
            filename_has_keywords = any(kw in filename for kw in ["blood", "report", "lab", "test", "cbc", "medical", "result", "analysis", "biomarker", "patient", "clinic"])
            
            if filename_has_keywords:
                if light_ratio > 0.30 or text_contour_count > 10:
                    return True
            else:
                if light_ratio > 0.40 and text_contour_count > 30:
                    return True
                    
            return False
        except Exception as e:
            print("Error in blood report validation:", e)
            return True
            
    # For PDF, check filename keywords or return True
    if ext == 'pdf':
        filename_has_keywords = any(kw in filename for kw in ["blood", "report", "lab", "test", "cbc", "medical", "result", "analysis", "biomarker", "patient", "clinic"])
        return filename_has_keywords
        
    return True

@app.route('/api/analyze-blood', methods=['POST'])
def analyze_blood():
    if 'report' not in request.files:
        return jsonify({'error': 'No document file uploaded'}), 400
        
    file = request.files['report']
    if file.filename == '':
        return jsonify({'error': 'No document file uploaded'}), 400
        
    # Validate if file is a blood report
    if not validate_blood_report(file):
        return jsonify({
            'success': False,
            'error': 'no_blood_report_detected'
        })
    
    # Simulate a document extraction delay or process
    return jsonify({
        'success': True,
        'biomarkers': BLOOD_BIOMARKERS_MOCK
    })

# --- DIAGNOSTIC HISTORY API ---
@app.route('/api/history', methods=['GET', 'POST'])
def history_api():
    conn = get_db()
    if request.method == 'GET':
        rows = conn.execute('SELECT * FROM diagnostics_history').fetchall()
        conn.close()
        # Decode individual report json arrays
        reports = []
        for r in rows:
            try:
                reports.append(json.loads(r['report_json']))
            except Exception as e:
                print(e)
        return jsonify(reports)
    else:
        data = request.json
        report_id = data.get('id')
        # Cache in memory for fast prescription lookup
        if report_id:
            _report_cache[report_id] = data
        conn.execute('INSERT OR REPLACE INTO diagnostics_history (id, report_json) VALUES (?, ?)', (
            report_id, json.dumps(data)
        ))
        conn.commit()
        rows = conn.execute('SELECT * FROM diagnostics_history').fetchall()
        conn.close()
        reports = []
        for r in rows:
            try:
                reports.append(json.loads(r['report_json']))
            except Exception as e:
                print(e)
        return jsonify(reports)

@app.route('/api/history/<report_id>', methods=['DELETE'])
def delete_history(report_id):
    conn = get_db()
    conn.execute('DELETE FROM diagnostics_history WHERE id = ?', (report_id,))
    conn.commit()
    rows = conn.execute('SELECT * FROM diagnostics_history').fetchall()
    conn.close()
    reports = []
    for r in rows:
        try:
            reports.append(json.loads(r['report_json']))
        except Exception as e:
            print(e)
    return jsonify(reports)

# --- CHAT ASSISTANT API ---
@app.route('/api/chat', methods=['POST'])
def chat_api():
    data = request.json
    user_msg = data.get('message', '').lower()
    lang = data.get('lang', 'en')
    
    bot_reply = ""
    
    if lang == 'bn':
        if 'হ্যালো' in user_msg or 'হাই' in user_msg:
            bot_reply = "হ্যালো! আমি আপনার এআই হেলথ অ্যাসিস্ট্যান্ট। আজ আপনাকে কীভাবে সাহায্য করতে পারি?"
        elif 'জ্বর' in user_msg or 'fever' in user_msg:
            bot_reply = "জ্বরের জন্য পর্যাপ্ত বিশ্রাম নিন, প্রচুর পরিমাণে জল পান করুন এবং শরীরের তাপমাত্রা লক্ষ্য করুন। যদি জ্বর ৩ দিনের বেশি থাকে, তবে ডাক্তারের পরামর্শ নিন।"
        elif 'মাথা' in user_msg or 'headache' in user_msg:
            bot_reply = "মাথাব্যথার ক্ষেত্রে শান্ত ও অন্ধকার ঘরে বিশ্রাম নিন, জল পান করুন এবং অতিরিক্ত স্ক্রিন টাইম এড়িয়ে চলুন।"
        else:
            bot_reply = "আমি আপনার লক্ষণগুলি সম্পর্কে বুঝতে পারছি। অনুগ্রহ করে মনে রাখবেন এটি কোনো নিশ্চিত চিকিৎসকের বিকল্প নয়। কোনো জটিলতার জন্য চিকিৎসকের পরামর্শ নিন。"
    elif lang == 'hi':
        if 'नमस्ते' in user_msg or 'हाय' in user_msg:
            bot_reply = "नमस्ते! मैं आपका एआई हेल्थ असिस्टेंट हूँ। आज मैं आपकी क्या सहायता कर सकता हूँ?"
        elif 'बुखार' in user_msg or 'fever' in user_msg:
            bot_reply = "बुखार के लिए पर्याप्त आराम करें, खूब पानी पिएं और शरीर का तापमान नोट करें। यदि बुखार 3 दिनों से अधिक रहता है, तो डॉक्टर से मिलें。"
        elif 'सिर' in user_msg or 'headache' in user_msg:
            bot_reply = "सिरदर्द के लिए शांत और अंधेरे कमरे में आराम करें, पानी पिएं और स्क्रीन टाइम को सीमित करें。"
        else:
            bot_reply = "मैं आपके लक्षणों को समझ सकता हूँ। कृपया ध्यान दें कि यह किसी चिकित्सक का विकल्प नहीं है। गंभीर स्थिति में तुरंत डॉक्टर से संपर्क करें。"
    else:
        if 'hello' in user_msg or 'hi' in user_msg:
            bot_reply = "Hello! I am your AI Health Assistant. How can I help you today?"
        elif 'fever' in user_msg or 'temp' in user_msg:
            bot_reply = "For fevers, rest as much as possible, keep hydrated with water/broths, and take paracetamol if needed. Consult a physician if it persists beyond 3 days."
        elif 'head' in user_msg or 'migraine' in user_msg:
            bot_reply = "For headaches, rest in a quiet, dark room, hydrate, and apply a cool compress. Avoid caffeine and loud screens."
        else:
            bot_reply = "I understand you have medical queries. Please note that this is a simulated AI guidance and does not replace official clinical diagnoses. Please consult a physician for urgent concerns."
            
    return jsonify({
        'reply': bot_reply
    })

# --- DIAGNOSTIC CONDITIONS DATABASE & EVALUATOR API ---
CONDITIONS_DB = [
    {
        "id": "cold",
        "name": "Common Cold",
        "name_bn": "\u09b8\u09be\u09a7\u09be\u09b0\u09a3 \u09b8\u09b0\u09cd\u09a6\u09bf-\u0995\u09be\u09b6\u09bf",
        "name_hi": "\u0938\u093e\u092e\u093e\u0928\u094d\u092f \u0938\u0930\u094d\u0926\u0940-\u091c\u0941\u0915\u093e\u092e",
        "primary": ["runny nose", "sore throat", "cough", "sere throat", "sore-throat", "runny-nose"],
        "secondary": ["fever", "headache", "muscle soreness", "muscle-soreness"],
        "urgency": "low",
        "specialist": "General Practitioner",
        "specialist_bn": "\u099c\u09c7\u09a8\u09be\u09b0\u09c7\u09b2 \u09ab\u09bf\u099c\u09bf\u09b6\u09bf\u09af\u09bc\u09be\u09a8",
        "specialist_hi": "\u0938\u093e\u092e\u093e\u0928\u094d\u092f \u091a\u093f\u0915\u093f\u0924\u094d\u0938\u0915",
        "explanation": "A general practitioner can rule out complex infections and direct symptomatic treatments.",
        "explanation_bn": "\u098f\u0995\u099c\u09a8 \u099c\u09c7\u09a8\u09be\u09b0\u09c7\u09b2 \u09ab\u09bf\u099c\u09bf\u09b6\u09bf\u09af\u09bc\u09be\u09a8 \u099c\u099f\u09bf\u09b2 \u09b8\u0982\u0995\u09cd\u09b0\u09ae\u09a3 \u09ac\u09be\u09a4\u09bf\u09b2 \u0995\u09b0\u09a4\u09c7 \u09aa\u09be\u09b0\u09c7\u09a8 \u098f\u09ac\u0982 \u09b2\u0995\u09cd\u09b7\u09a3\u09ad\u09bf\u09a4\u09cd\u09a4\u09bf\u0995 \u099a\u09bf\u0995\u09bf\u09ce\u09b8\u09be\u09b0 \u09aa\u09b0\u09be\u09ae\u09b0\u09cd\u09b6 \u09a6\u09bf\u09a4\u09c7 \u09aa\u09be\u09b0\u09c7\u09a8\u0964",
        "explanation_hi": "\u090f\u0915 \u0938\u093e\u092e\u093e\u0928\u094d\u092f \u091a\u093f\u0915\u093f\u0924\u094d\u0938\u0915 \u091c\u091f\u093f\u0932 \u0938\u0902\u0915\u094d\u0930\u092e\u0923\u094b\u0902 \u0915\u094b \u0916\u093e\u0930\u093f\u091c \u0915\u0930 \u0938\u0915\u0924\u093e \u0939\u0948 \u0914\u0930 \u092a\u094d\u0930\u0924\u0940\u0915\u093e\u0924\u094d\u092e\u0915 \u0909\u092a\u091a\u093e\u0930\u094b\u0902 \u0915\u094b \u0928\u093f\u0930\u094d\u0926\u0947\u0936\u093f\u0924 \u0915\u0930 \u0938\u0915\u0924\u093e \u0939\u0948\u0964",
        "desc": "A mild viral infection of the nose and throat.",
        "desc_bn": "\u09a8\u09be\u0995 \u0993 \u0997\u09b2\u09be\u09b0 \u098f\u0995\u099f\u09bf \u09ae\u09c3\u09a6\u09c1 \u09ad\u09be\u0987\u09b0\u09be\u09b2 \u09b8\u0982\u0995\u09cd\u09b0\u09ae\u09a3\u0964",
        "desc_hi": "\u0928\u093e\u0915 \u0914\u0930 \u0917\u0932\u0947 \u0915\u093e \u090f\u0915 \u0939\u0932\u094d\u0915\u093e \u0935\u093e\u092f\u0930\u0932 \u0938\u0902\u0915\u094d\u0930\u092e\u0923\u0964",
        "selfCare": [
            "Prioritize rest and avoid strenuous physical activity.",
            "Drink warm liquids (herbal tea, broth) to soothe the throat.",
            "Consider saline nasal sprays or steam inhalation to ease congestion."
        ],
        "selfCare_bn": [
            "\u09ac\u09bf\u09b6\u09cd\u09b0\u09be\u09ae\u0995\u09c7 \u0985\u0997\u09cd\u09b0\u09be\u09a7\u09bf\u0995\u09be\u09b0 \u09a6\u09bf\u09a8 \u098f\u09ac\u0982 \u0995\u09a0\u09cb\u09b0 \u09b6\u09be\u09b0\u09c0\u09b0\u09bf\u0995 \u09aa\u09b0\u09bf\u09b6\u09cd\u09b0\u09ae \u098f\u09dc\u09bf\u09af\u09bc\u09c7 \u099a\u09b2\u09c1\u09a8\u0964",
            "\u0997\u09b2\u09be \u09ac\u09cd\u09af\u09a5\u09be \u0989\u09aa\u09b6\u09ae \u0995\u09b0\u09a4\u09c7 \u0997\u09b0\u09ae \u09a4\u09b0\u09b2 \u09aa\u09be\u09a8 \u0995\u09b0\u09c1\u09a8\u0964",
            "\u09a8\u09be\u0995 \u09ac\u09a8\u09cd\u09a7 \u09ad\u09be\u09ac \u0995\u09ae\u09be\u09a4\u09c7 \u09b8\u09cd\u09af\u09be\u09b2\u09be\u0987\u09a8 \u09b8\u09cd\u09aa\u09cd\u09b0\u09c7 \u09ac\u09be \u0997\u09b0\u09ae \u099c\u09b2\u09c7\u09b0 \u09ad\u09be\u09aa \u09a8\u09bf\u09a8\u0964"
        ],
        "selfCare_hi": [
            "\u0906\u0930\u093e\u092e \u0915\u094b \u092a\u094d\u0930\u093e\u0925\u092e\u093f\u0915\u0924\u093e \u0926\u0947\u0902 \u0914\u0930 \u092d\u093e\u0930\u0940 \u0936\u093e\u0930\u0940\u0930\u093f\u0915 \u0917\u0924\u093f\u0935\u093f\u0927\u093f\u092f\u094b\u0902 \u0938\u0947 \u092c\u091a\u0947\u0902\u0964",
            "\u0917\u0932\u0947 \u0915\u094b \u0906\u0930\u093e\u092e \u0926\u0947\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f \u0917\u0930\u094d\u092e \u0924\u0930\u0932 \u092a\u0926\u093e\u0930\u094d\u0925 \u092a\u093f\u090f\u0902\u0964",
            "\u0928\u093e\u0915 \u092c\u0902\u0926 \u0939\u094b\u0928\u0947 \u0915\u0940 \u0938\u092e\u0938\u094d\u092f\u093e \u0915\u094b \u0915\u092e \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f \u0916\u093e\u0930\u0947 \u092a\u093e\u0928\u0940 \u0915\u0947 \u0938\u094d\u092a\u094d\u0930\u0947 \u092f\u093e \u092d\u093e\u092a \u0915\u093e \u092a\u094d\u0930\u092f\u094b\u0917 \u0915\u0930\u0947\u0902\u0964"
        ],
        "medicines": [
            {"name": "Paracetamol 500mg", "dose": "1 tablet every 6-8 hours (max 4/day)", "note": "For fever & throat pain"},
            {"name": "Cetirizine 10mg", "dose": "1 tablet once daily at night", "note": "For runny nose & sneezing"},
            {"name": "Dextromethorphan Syrup", "dose": "10 ml every 6-8 hours", "note": "For dry cough relief"},
            {"name": "Vitamin C 500mg", "dose": "1 tablet twice daily", "note": "Boosts immunity"}
        ],
        "medicines_bn": [
            {"name": "\u09aa\u09cd\u09af\u09be\u09b0\u09be\u09b8\u09bf\u099f\u09be\u09ae\u09b2 \u09eb\u09e6\u09e6\u09ae\u09bf\u0997\u09cd\u09b0\u09be", "dose": "\u09e7\u099f\u09bf \u099f\u09cd\u09af\u09be\u09ac\u09b2\u09c7\u099f \u09aa\u09cd\u09b0\u09a4\u09bf \u09ec-\u09ee \u0998\u09a3\u09cd\u099f\u09be \u0985\u09a8\u09cd\u09a4\u09b0", "note": "\u099c\u09cd\u09ac\u09b0 \u0993 \u0997\u09b2\u09be \u09ac\u09cd\u09af\u09a5\u09be\u09b0 \u099c\u09a8\u09cd\u09af"},
            {"name": "\u09b8\u09c7\u099f\u09bf\u09b0\u09bf\u099c\u09bf\u09a8 \u09e7\u09e6\u09ae\u09bf\u0997\u09cd\u09b0\u09be", "dose": "\u09e7\u099f\u09bf \u099f\u09cd\u09af\u09be\u09ac\u09b2\u09c7\u099f \u09aa\u09cd\u09b0\u09a4\u09bf\u09a6\u09bf\u09a8 \u09b0\u09be\u09a4\u09c7 \u098f\u0995\u09ac\u09be\u09b0", "note": "\u09b8\u09b0\u09cd\u09a6\u09bf \u0993 \u09b9\u09be\u0981\u099a\u09bf\u09b0 \u0989\u09aa\u09b6\u09ae\u09c7"},
            {"name": "\u09a1\u09c7\u0995\u09cd\u09b8\u099f\u09cd\u09b0\u09cb\u09ae\u09c7\u09a5\u09b0\u09ab\u09be\u09a8 \u09b8\u09bf\u09b0\u09be\u09aa", "dose": "\u09e7\u09e6 \u09ae\u09bf\u09b2\u09bf \u09aa\u09cd\u09b0\u09a4\u09bf \u09ec-\u09ee \u0998\u09a3\u09cd\u099f\u09be \u0985\u09a8\u09cd\u09a4\u09b0", "note": "\u09b6\u09c1\u09b7\u09cd\u0995 \u0995\u09be\u09b6\u09bf\u09b0 \u0989\u09aa\u09b6\u09ae\u09c7"},
            {"name": "\u09ad\u09bf\u099f\u09be\u09ae\u09bf\u09a8 \u09b8\u09bf \u09eb\u09e6\u09e6\u09ae\u09bf\u0997\u09cd\u09b0\u09be", "dose": "\u09e7\u099f\u09bf \u099f\u09cd\u09af\u09be\u09ac\u09b2\u09c7\u099f \u09a6\u09bf\u09a8\u09c7 \u09a6\u09c1\u0987\u09ac\u09be\u09b0", "note": "\u09b0\u09cb\u0997 \u09aa\u09cd\u09b0\u09a4\u09bf\u09b0\u09cb\u09a7 \u0995\u09cd\u09b7\u09ae\u09a4\u09be \u09ac\u09be\u09dc\u09be\u09af\u09bc"}
        ],
        "medicines_hi": [
            {"name": "\u092a\u0948\u0930\u093e\u0938\u093f\u091f\u093e\u092e\u094b\u0932 500mg", "dose": "1 \u091f\u0948\u092c\u0932\u0947\u091f \u0939\u0930 6-8 \u0918\u0902\u091f\u0947 \u092e\u0947\u0902", "note": "\u092c\u0941\u0916\u093e\u0930 \u0914\u0930 \u0917\u0932\u0947 \u0915\u0947 \u0926\u0930\u094d\u0926 \u0915\u0947 \u0932\u093f\u090f"},
            {"name": "\u0938\u0947\u091f\u093f\u0930\u093f\u091c\u093c\u093f\u0928 10mg", "dose": "1 \u091f\u0948\u092c\u0932\u0947\u091f \u0930\u094b\u091c\u093e\u0928\u093e \u0930\u093e\u0924 \u092e\u0947\u0902 \u090f\u0915 \u092c\u093e\u0930", "note": "\u092c\u0939\u0924\u0940 \u0928\u093e\u0915 \u0914\u0930 \u091b\u0940\u0902\u0915\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f"},
            {"name": "\u0921\u0947\u0915\u094d\u0938\u094d\u091f\u094d\u0930\u094b\u092e\u0947\u0925\u0949\u0930\u094d\u092b\u093c\u0928 \u0938\u093f\u0930\u092a", "dose": "10 \u092e\u093f\u0932\u0940 \u0939\u0930 6-8 \u0918\u0902\u091f\u0947 \u092e\u0947\u0902", "note": "\u0938\u0942\u0916\u0940 \u0916\u093e\u0902\u0938\u0940 \u0938\u0947 \u0930\u093e\u0939\u0924"},
            {"name": "\u0935\u093f\u091f\u093e\u092e\u093f\u0928 \u0938\u0940 500mg", "dose": "1 \u091f\u0948\u092c\u0932\u0947\u091f \u0926\u093f\u0928 \u092e\u0947\u0902 \u0926\u094b \u092c\u093e\u0930", "note": "\u092a\u094d\u0930\u0924\u093f\u0930\u094b\u0927\u0915 \u0915\u094d\u0937\u092e\u0924\u093e \u092c\u0922\u093c\u093e\u0924\u093e \u0939\u0948"}
        ]
    },
    {
        "id": "flu",
        "name": "Influenza (Flu)",
        "name_bn": "\u0987\u09a8\u09ab\u09cd\u09b2\u09c1\u09af\u09bc\u09c7\u099e\u09cd\u099c\u09be (\u09ab\u09cd\u09b2\u09c1)",
        "name_hi": "\u0907\u0928\u094d\u092b\u094d\u0932\u0941\u090f\u0902\u091c\u093e (\u092b\u094d\u0932\u0942)",
        "primary": ["fever", "cough", "muscle soreness", "headache", "muscle-soreness"],
        "secondary": ["sore throat", "runny nose", "dizziness", "sore-throat", "runny-nose"],
        "urgency": "medium",
        "specialist": "General Practitioner",
        "specialist_bn": "\u099c\u09c7\u09a8\u09be\u09b0\u09c7\u09b2 \u09ab\u09bf\u099c\u09bf\u09b6\u09bf\u09af\u09bc\u09be\u09a8",
        "specialist_hi": "\u0938\u093e\u092e\u093e\u0928\u094d\u092f \u091a\u093f\u0915\u093f\u0924\u094d\u0938\u0915",
        "explanation": "A GP can prescribe anti-viral medications if diagnosed within 48 hours of symptom onset.",
        "explanation_bn": "\u09b2\u0995\u09cd\u09b7\u09a3 \u09a6\u09c7\u0996\u09be \u09a6\u09c7\u0993\u09af\u09bc\u09be\u09b0 \u09ea\u09ee \u0998\u09a3\u09cd\u099f\u09be\u09b0 \u09ae\u09a7\u09cd\u09af\u09c7 \u09b0\u09cb\u0997 \u09a8\u09bf\u09b0\u09cd\u09a3\u09af\u09bc \u09b9\u09b2\u09c7 \u098f\u0995\u099c\u09a8 \u099c\u09bf\u09aa\u09bf \u0985\u09cd\u09af\u09be\u09a8\u09cd\u099f\u09bf-\u09ad\u09be\u0987\u09b0\u09be\u09b2 \u0993\u09b7\u09c1\u09a7 \u09b2\u09bf\u0996\u09c7 \u09a6\u09bf\u09a4\u09c7 \u09aa\u09be\u09b0\u09c7\u09a8\u0964",
        "explanation_hi": "\u0932\u0915\u094d\u0937\u0923\u094b\u0902 \u0915\u0940 \u0936\u0941\u0930\u0941\u0906\u0924 \u0915\u0947 48 \u0918\u0902\u091f\u094b\u0902 \u0915\u0947 \u092d\u0940\u0924\u0930 \u0928\u093f\u0926\u093e\u0928 \u0939\u094b\u0928\u0947 \u092a\u0930 \u090f\u0915 \u0938\u093e\u092e\u093e\u0928\u094d\u092f \u091a\u093f\u0915\u093f\u0924\u094d\u0938\u0915 \u090f\u0902\u091f\u093f-\u0935\u093e\u092f\u0930\u0932 \u0926\u0935\u093e\u090f\u0902 \u0932\u093f\u0916 \u0938\u0915\u0924\u093e \u0939\u0948\u0964",
        "desc": "A highly contagious viral infection of the respiratory passages.",
        "desc_bn": "\u09a8\u09be\u0995 \u0993 \u0997\u09b2\u09be\u09b0 \u098f\u0995\u099f\u09bf \u0985\u09a4\u09cd\u09af\u09a8\u09cd\u09a4 \u09b8\u0982\u0995\u09cd\u09b0\u09be\u09ae\u0995 \u09ad\u09be\u0987\u09b0\u09be\u09b2 \u09b8\u0982\u0995\u09cd\u09b0\u09ae\u09a3\u0964",
        "desc_hi": "\u0936\u094d\u0935\u0938\u0928 \u092e\u093e\u0930\u094d\u0917\u094b\u0902 \u0915\u093e \u090f\u0915 \u0905\u0924\u094d\u092f\u0927\u093f\u0915 \u0938\u0902\u0915\u094d\u0930\u093e\u092e\u0915 \u0935\u093e\u092f\u0930\u0932 \u0938\u0902\u0915\u094d\u0930\u092e\u0923\u0964",
        "selfCare": [
            "Commit to complete bed rest for the first 3 days.",
            "Hydrate heavily with water, coconut water, or electrolyte solutions.",
            "Manage high fever with cooling pads and OTC antipyretics."
        ],
        "selfCare_bn": [
            "\u09aa\u09cd\u09b0\u09a5\u09ae \u09e9 \u09a6\u09bf\u09a8 \u09b8\u09ae\u09cd\u09aa\u09c2\u09b0\u09cd\u09a3 \u09ac\u09bf\u099b\u09be\u09a8\u09be\u09af\u09bc \u09ac\u09bf\u09b6\u09cd\u09b0\u09be\u09ae \u09a8\u09bf\u09a8\u0964",
            "\u09aa\u09cd\u09b0\u099a\u09c1\u09b0 \u09aa\u09b0\u09bf\u09ae\u09be\u09a3\u09c7 \u099c\u09b2, \u09a1\u09be\u09ac\u09c7\u09b0 \u099c\u09b2 \u09ac\u09be \u0987\u09b2\u09c7\u0995\u099f\u09cd\u09b0\u09cb\u09b2\u09be\u0987\u099f \u099c\u09b2 \u09aa\u09be\u09a8 \u0995\u09b0\u09c1\u09a8\u0964",
            "\u0995\u09c1\u09b2\u09bf\u0982 \u09aa\u09cd\u09af\u09be\u09a1 \u09a6\u09bf\u09af\u09bc\u09c7 \u0989\u099a\u09cd\u099a \u099c\u09cd\u09ac\u09b0 \u09a8\u09bf\u09af\u09bc\u09a8\u09cd\u09a4\u09cd\u09b0\u09a3 \u0995\u09b0\u09c1\u09a8\u0964"
        ],
        "selfCare_hi": [
            "\u092a\u0939\u0932\u0947 3 \u0926\u093f\u0928\u094b\u0902 \u0915\u0947 \u0932\u093f\u090f \u092a\u0942\u0930\u0940 \u0924\u0930\u0939 \u0938\u0947 \u0906\u0930\u093e\u092e \u0915\u0930\u0947\u0902\u0964",
            "\u092a\u093e\u0928\u0940, \u0928\u093e\u0930\u093f\u092f\u0932 \u092a\u093e\u0928\u0940 \u092f\u093e \u0907\u0932\u0947\u0915\u094d\u091f\u094d\u0930\u094b\u0932\u093e\u0907\u091f \u0918\u094b\u0932 \u0938\u0947 \u092d\u0930\u092a\u0942\u0930 \u0939\u093e\u0907\u0921\u094d\u0930\u0947\u091f \u0930\u0939\u0947\u0902\u0964",
            "\u0915\u0942\u0932\u093f\u0902\u0917 \u092a\u0948\u0921 \u0914\u0930 \u0913\u091f\u0940\u0938\u0940 \u092c\u0941\u0916\u093e\u0930 \u0928\u093e\u0936\u0915 \u0926\u0935\u093e\u0913\u0902 \u0938\u0947 \u0924\u0947\u091c \u092c\u0941\u0916\u093e\u0930 \u0915\u094b \u0928\u093f\u092f\u0902\u0924\u094d\u0930\u093f\u0924 \u0915\u0930\u0947\u0902\u0964"
        ],
        "medicines": [
            {"name": "Ibuprofen 400mg", "dose": "1 tablet twice daily after meals", "note": "For body ache & high fever"},
            {"name": "Phenylephrine 10mg", "dose": "1 tablet every 4-6 hours", "note": "For nasal congestion"},
            {"name": "Vitamin C & Zinc", "dose": "1 tablet daily", "note": "Supports immune system recovery"}
        ],
        "medicines_bn": [
            {"name": "\u0986\u0987\u09ac\u09c1\u09aa\u09cd\u09b0\u09cb\u09ab\u09c7\u09a8 \u09ea\u09e6\u09e6\u09ae\u09bf\u0997\u09cd\u09b0\u09be", "dose": "\u09a6\u09bf\u09a8\u09c7 \u09a6\u09c1\u0987\u09ac\u09be\u09b0 \u0996\u09be\u09ac\u09be\u09b0\u09c7\u09b0 \u09aa\u09b0 \u09e7\u099f\u09bf \u099f\u09cd\u09af\u09be\u09ac\u09b2\u09c7\u099f", "note": "\u09b6\u09b0\u09c0\u09b0 \u09ac\u09cd\u09af\u09a5\u09be \u0993 \u0989\u099a\u09cd\u099a \u099c\u09cd\u09ac\u09b0\u09c7"},
            {"name": "\u09ab\u09bf\u09a8\u09be\u0987\u09b2\u098f\u09ab\u09cd\u09b0\u09bf\u09a8 \u09e7\u09e6\u09ae\u09bf\u0997\u09cd\u09b0\u09be", "dose": "\u09aa\u09cd\u09b0\u09a4\u09bf \u09ea-\u09ec \u0998\u09a3\u09cd\u099f\u09be \u0985\u09a8\u09cd\u09a4\u09b0 \u09e7\u099f\u09bf \u099f\u09cd\u09af\u09be\u09ac\u09b2\u09c7\u099f", "note": "\u09a8\u09be\u0995 \u09ac\u09a8\u09cd\u09a7 \u09ad\u09be\u09ac \u0989\u09aa\u09b6\u09ae\u09c7"},
            {"name": "\u09ad\u09bf\u099f\u09be\u09ae\u09bf\u09a8 \u09b8\u09bf \u098f\u09ac\u0982 \u099c\u09bf\u0982\u0995", "dose": "\u09aa\u09cd\u09b0\u09a4\u09bf\u09a6\u09bf\u09a8 \u09e7\u099f\u09bf \u099f\u09cd\u09af\u09be\u09ac\u09b2\u09c7\u099f", "note": "\u09b0\u09cb\u0997 \u09aa\u09cd\u09b0\u09a4\u09bf\u09b0\u09cb\u09a7 \u0995\u09cd\u09b7\u09ae\u09a4\u09be \u09aa\u09c1\u09a8\u09b0\u09c1\u09a6\u09cd\u09a7\u09be\u09b0\u09c7"}
        ],
        "medicines_hi": [
            {"name": "\u0907\u092c\u0941\u092a\u094d\u0930\u094b\u092b\u0947\u0928 400mg", "dose": "\u092d\u094b\u091c\u0928 \u0915\u0947 \u092c\u093e\u0926 \u0926\u093f\u0928 \u092e\u0947\u0902 \u0926\u094b \u092c\u093e\u0930 1 \u091f\u0948\u092c\u0932\u0947\u091f", "note": "\u092c\u0926\u0928 \u0926\u0930\u094d\u0926 \u0914\u0930 \u0924\u0947\u091c \u092c\u0941\u0916\u093e\u0930"},
            {"name": "\u092b\u093f\u0928\u093e\u0907\u0932\u0947\u092b\u094d\u0930\u093f\u0928 10mg", "dose": "\u0939\u0930 4-6 \u0918\u0902\u091f\u0947 \u092e\u0947\u0902 1 \u091f\u0948\u092c\u0932\u0947\u091f", "note": "\u092c\u0902\u0926 \u0928\u093e\u0915 \u0938\u0947 \u0930\u093e\u0939\u0924"},
            {"name": "\u0935\u093f\u091f\u093e\u092e\u093f\u0928 \u0938\u0940 \u0914\u0930 \u091c\u093f\u0902\u0915", "dose": "\u0930\u094b\u091c\u093e\u0928\u093e 1 \u091f\u0948\u092c\u0932\u0947\u091f", "note": "\u092a\u094d\u0930\u0924\u093f\u0930\u094b\u0927\u0915 \u0915\u094d\u0937\u092e\u0924\u093e"}
        ]
    },
    {
        "id": "migraine",
        "name": "Migraine Headache",
        "name_bn": "\u09ae\u09be\u0987\u0997\u09cd\u09b0\u09c7\u09a8 \u09ae\u09be\u09a5\u09be\u09ac\u09cd\u09af\u09a5\u09be",
        "name_hi": "\u092e\u093e\u0907\u0917\u094d\u0930\u0947\u0928 \u0915\u093e \u0938\u093f\u0930\u0926\u0930\u094d\u0926",
        "primary": ["headache", "nausea", "dizziness"],
        "secondary": ["muscle soreness", "muscle-soreness"],
        "urgency": "low",
        "specialist": "Neurologist",
        "specialist_bn": "\u09a8\u09bf\u0989\u09b0\u09cb\u09b2\u099c\u09bf\u09b8\u09cd\u099f",
        "specialist_hi": "\u0928\u094d\u092f\u0942\u0930\u094b\u0932\u0949\u091c\u093f\u0938\u094d\u091f",
        "explanation": "A neurologist helps diagnose chronic headache disorders and prescribe preventive therapies.",
        "explanation_bn": "\u098f\u0995\u099c\u09a8 \u09a8\u09bf\u0989\u09b0\u09cb\u09b2\u099c\u09bf\u09b8\u09cd\u099f \u09a6\u09c0\u09b0\u09cd\u0998\u09b8\u09cd\u09a5\u09be\u09af\u09bc\u09c0 \u09ae\u09be\u09a5\u09be\u09ac\u09cd\u09af\u09a5\u09be\u09b0 \u0995\u09be\u09b0\u09a3 \u09a8\u09bf\u09b0\u09cd\u09a3\u09af\u09bc \u0995\u09b0\u09a4\u09c7 \u09b8\u09be\u09b9\u09be\u09af\u09cd\u09af \u0995\u09b0\u09c7\u09a8\u0964",
        "explanation_hi": "\u090f\u0915 \u0928\u094d\u092f\u0942\u0930\u094b\u0932\u0949\u091c\u093f\u0938\u094d\u091f \u092a\u0941\u0930\u093e\u0928\u0940 \u0938\u093f\u0930\u0926\u0930\u094d\u0926 \u0915\u0940 \u0938\u092e\u0938\u094d\u092f\u093e\u0913\u0902 \u0915\u093e \u0928\u093f\u0926\u093e\u0928 \u0915\u0930\u0928\u0947 \u092e\u0947\u0902 \u092e\u0926\u0926 \u0915\u0930\u0924\u093e \u0939\u0948\u0964",
        "desc": "A neurological condition characterized by intense, throbbing headaches.",
        "desc_bn": "\u098f\u0995\u099f\u09bf \u09a4\u09c0\u09ac\u09cd\u09b0, \u09a6\u09aa\u09a6\u09aa \u0995\u09b0\u09be \u09ae\u09be\u09a5\u09be\u09ac\u09cd\u09af\u09a5\u09be\u09b0 \u09b8\u09cd\u09a8\u09be\u09af\u09bc\u09ac\u09bf\u0995 \u0985\u09ac\u09b8\u09cd\u09a5\u09be\u0964",
        "desc_hi": "\u090f\u0915 \u0928\u094d\u092f\u0942\u0930\u094b\u0932\u0949\u091c\u093f\u0915\u0932 \u0938\u094d\u0925\u093f\u0924\u093f \u091c\u094b \u0924\u0940\u0935\u094d\u0930, \u0927\u0921\u093c\u0915\u0924\u0947 \u0938\u093f\u0930\u0926\u0930\u094d\u0926 \u0915\u0940 \u0935\u093f\u0936\u0947\u0937\u0924\u093e \u0939\u0948\u0964",
        "selfCare": [
            "Rest in a completely dark, quiet room during an attack.",
            "Apply a cold, damp cloth or ice pack to the forehead.",
            "Avoid triggers such as caffeine, bright screens, and loud noises."
        ],
        "selfCare_bn": [
            "\u09ae\u09be\u09a5\u09be\u09ac\u09cd\u09af\u09a5\u09be \u09b6\u09c1\u09b0\u09c1 \u09b9\u09b2\u09c7 \u09b8\u09ae\u09cd\u09aa\u09c2\u09b0\u09cd\u09a3 \u0985\u09a8\u09cd\u09a7\u0995\u09be\u09b0, \u09b6\u09be\u09a8\u09cd\u09a4 \u0998\u09b0\u09c7 \u09ac\u09bf\u09b6\u09cd\u09b0\u09be\u09ae \u09a8\u09bf\u09a8\u0964",
            "\u0995\u09aa\u09be\u09b2\u09c7 \u098f\u0995\u099f\u09bf \u09a0\u09be\u09a3\u09cd\u09a1\u09be \u09ad\u09c7\u099c\u09be \u0995\u09be\u09aa\u09dc \u09ac\u09be \u09ac\u09b0\u09ab\u09c7\u09b0 \u09aa\u09cd\u09af\u09be\u0995 \u09a6\u09bf\u09a8\u0964",
            "\u0995\u09cd\u09af\u09be\u09ab\u09c7\u0987\u09a8, \u0989\u099c\u09cd\u099c\u09cd\u09ac\u09b2 \u09b8\u09cd\u0995\u09cd\u09b0\u09bf\u09a8 \u098f\u09dc\u09bf\u09af\u09bc\u09c7 \u099a\u09b2\u09c1\u09a8\u0964"
        ],
        "selfCare_hi": [
            "\u0939\u092e\u0932\u0947 \u0915\u0947 \u0926\u094c\u0930\u093e\u0928 \u092a\u0942\u0930\u0940 \u0924\u0930\u0939 \u0938\u0947 \u0905\u0902\u0927\u0947\u0930\u0947, \u0936\u093e\u0902\u0924 \u0915\u092e\u0930\u0947 \u092e\u0947\u0902 \u0906\u0930\u093e\u092e \u0915\u0930\u0947\u0902\u0964",
            "\u092e\u093e\u0925\u0947 \u092a\u0930 \u090f\u0915 \u0920\u0902\u0921\u093e, \u0928\u092e \u0915\u092a\u0921\u093c\u093e \u0932\u0917\u093e\u090f\u0902\u0964",
            "\u0915\u0948\u092b\u0940\u0928, \u091a\u092e\u0915\u0926\u093e\u0930 \u0938\u094d\u0915\u094d\u0930\u0940\u0928 \u0938\u0947 \u092c\u091a\u0947\u0902\u0964"
        ],
        "medicines": [
            {"name": "Naproxen 250mg", "dose": "1 tablet twice daily", "note": "For severe headache relief"},
            {"name": "Domperidone 10mg", "dose": "1 tablet 30 mins before meals", "note": "For nausea and vomiting relief"},
            {"name": "Paracetamol 650mg", "dose": "1 tablet as needed (max 3/day)", "note": "For pain relief"}
        ],
        "medicines_bn": [
            {"name": "\u09a8\u09c7\u09aa\u09cd\u09b0\u09cb\u0995\u09cd\u09b8\u09c7\u09a8 \u09e8\u09eb\u09e6\u09ae\u09bf\u0997\u09cd\u09b0\u09be", "dose": "\u09a6\u09bf\u09a8\u09c7 \u09a6\u09c1\u0987\u09ac\u09be\u09b0 \u09e7\u099f\u09bf \u099f\u09cd\u09af\u09be\u09ac\u09b2\u09c7\u099f", "note": "\u09a4\u09c0\u09ac\u09cd\u09b0 \u09ae\u09be\u09a5\u09be\u09ac\u09cd\u09af\u09a5\u09be\u09b0 \u0989\u09aa\u09b6\u09ae\u09c7"},
            {"name": "\u09a1\u09ae\u09aa\u09c7\u09b0\u09bf\u09a1\u09a8 \u09e7\u09e6\u09ae\u09bf\u0997\u09cd\u09b0\u09be", "dose": "\u0996\u09be\u09ac\u09be\u09b0\u09c7\u09b0 \u09e9\u09e6 \u09ae\u09bf\u09a8\u09bf\u099f \u0986\u0997\u09c7 \u09e7\u099f\u09bf \u099f\u09cd\u09af\u09be\u09ac\u09b2\u09c7\u099f", "note": "\u09ac\u09ae\u09bf \u09ad\u09be\u09ac \u0993 \u09ac\u09ae\u09bf \u0989\u09aa\u09b6\u09ae\u09c7"},
            {"name": "\u09aa\u09cd\u09af\u09be\u09b0\u09be\u09b8\u09bf\u099f\u09be\u09ae\u09b2 \u09ec\u09eb\u09e6\u09ae\u09bf\u0997\u09cd\u09b0\u09be", "dose": "\u09aa\u09cd\u09b0\u09af\u09bc\u09cb\u099c\u09a8 \u0985\u09a8\u09c1\u09af\u09be\u09af\u09bc\u09c0 \u09e7\u099f\u09bf \u099f\u09cd\u09af\u09be\u09ac\u09b2\u09c7\u099f", "note": "\u09ac\u09cd\u09af\u09be\u09a5\u09be \u0995\u09ae\u09be\u09a8\u09cb\u09b0 \u099c\u09a8\u09cd\u09af"}
        ],
        "medicines_hi": [
            {"name": "\u0928\u0947\u092a\u094d\u0930\u094b\u0915\u094d\u0938\u0928 250mg", "dose": "\u0926\u093f\u0928 \u092e\u0947\u0902 \u0926\u094b \u092c\u093e\u0930 1 \u091f\u0948\u092c\u0932\u0947\u091f", "note": "\u0917\u0902\u092d\u0940\u0930 \u0938\u093f\u0930\u0926\u0930\u094d\u0926 \u0938\u0947 \u0930\u093e\u0939\u0924"},
            {"name": "\u0921\u094b\u092e\u092a\u0947\u0930\u093f\u0921\u094b\u0928 10mg", "dose": "\u092d\u094b\u091c\u0928 \u0938\u0947 30 \u092e\u093f\u0928\u091f \u092a\u0939\u0932\u0947 1 \u091f\u0948\u092c\u0932\u0947\u091f", "note": "\u092e\u0924\u0932\u0940 \u0914\u0930 \u0909\u0932\u094d\u091f\u0940 \u0938\u0947 \u0930\u093e\u0939\u0924"},
            {"name": "\u092a\u0948\u0930\u093e\u0938\u093f\u091f\u093e\u092e\u094b\u0932 650mg", "dose": "\u0906\u0935\u0936\u094d\u092f\u0915\u0924\u093e\u0928\u0941\u0938\u093e\u0930 1 \u091f\u0948\u092c\u0932\u0947\u091f", "note": "\u0926\u0930\u094d\u0926 \u0938\u0947 \u0930\u093e\u0939\u0924"}
        ]
    },
    {
        "id": "gastroenteritis",
        "name": "Gastroenteritis",
        "name_bn": "\u0997\u09cd\u09af\u09be\u09b8\u09cd\u099f\u09cd\u09b0\u09cb\u098f\u09a8\u09cd\u099f\u09be\u09b0\u099f\u09be\u0987\u099f\u09bf\u09b8",
        "name_hi": "\u0917\u0948\u0938\u094d\u091f\u094d\u0930\u094b\u090f\u0902\u091f\u0947\u0930\u093e\u0907\u091f\u093f\u0938",
        "primary": ["stomach ache", "stomach-ache", "nausea", "vomiting", "bloating"],
        "secondary": ["fever", "dizziness"],
        "urgency": "low",
        "specialist": "Gastroenterologist",
        "specialist_bn": "\u0997\u09cd\u09af\u09be\u09b8\u09cd\u099f\u09cd\u09b0\u09cb\u098f\u09a8\u09cd\u099f\u09be\u09b0\u09cb\u09b2\u099c\u09bf\u09b8\u09cd\u099f",
        "specialist_hi": "\u0917\u0948\u0938\u094d\u091f\u094d\u0930\u094b\u090f\u0902\u091f\u0947\u0930\u094b\u0932\u0949\u091c\u093f\u0938\u094d\u091f",
        "explanation": "A gastroenterologist evaluates stomach and intestinal issues if symptoms persist beyond a week.",
        "explanation_bn": "\u09b2\u0995\u09cd\u09b7\u09a3\u0997\u09c1\u09b2\u09bf \u098f\u0995 \u09b8\u09aa\u09cd\u09a4\u09be\u09b9\u09c7\u09b0 \u09ac\u09c7\u09b6\u09bf \u09b8\u09cd\u09a5\u09be\u09af\u09bc\u09c0 \u09b9\u09b2\u09c7 \u09aa\u09b0\u09be\u09ae\u09b0\u09cd\u09b6 \u09a8\u09bf\u09a8\u0964",
        "explanation_hi": "\u092f\u0926\u093f \u0932\u0915\u094d\u0937\u0923 \u090f\u0915 \u0938\u092a\u094d\u0924\u093e\u0939 \u0938\u0947 \u0905\u0927\u093f\u0915 \u0938\u092e\u092f \u0924\u0915 \u092c\u0928\u0947 \u0930\u0939\u0924\u0947 \u0939\u0948\u0902, \u0924\u094b \u0935\u093f\u0936\u0947\u0937\u091c\u094d\u091e \u0938\u0947 \u092e\u093f\u0932\u0947\u0902\u0964",
        "desc": "Inflammation of the stomach and intestines.",
        "desc_bn": "\u09aa\u09be\u0995\u09b8\u09cd\u09a5\u09b2\u09c0 \u098f\u09ac\u0982 \u0985\u09a8\u09cd\u09a4\u09cd\u09b0\u09c7\u09b0 \u09aa\u09cd\u09b0\u09a6\u09be\u09b9\u0964",
        "desc_hi": "\u092a\u0947\u091f \u0914\u0930 \u0906\u0902\u0924\u094b\u0902 \u0915\u0940 \u0938\u0942\u091c\u0928\u0964",
        "selfCare": [
            "Sip clear fluids slowly in small increments to prevent nausea.",
            "Introduce bland, solid foods like bananas, rice, applesauce.",
            "Ensure rehydration using Oral Rehydration Salts (ORS) if vomiting is frequent."
        ],
        "selfCare_bn": [
            "\u09ac\u09ae\u09bf \u09ad\u09be\u09ac \u09b0\u09cb\u09a7 \u0995\u09b0\u09a4\u09c7 \u0985\u09b2\u09cd\u09aa \u0985\u09b2\u09cd\u09aa \u0995\u09b0\u09c7 \u09aa\u09b0\u09bf\u09b7\u09cd\u0995\u09be\u09b0 \u09a4\u09b0\u09b2 \u099a\u09c1\u09ae\u09c1\u0995 \u09a6\u09bf\u09af\u09bc\u09c7 \u09aa\u09be\u09a8 \u0995\u09b0\u09c1\u09a8\u0964",
            "\u09b8\u09b9\u099c\u09c7 \u09b9\u099c\u09ae\u09af\u09cb\u0997\u09cd\u09af \u0996\u09be\u09ac\u09be\u09b0 \u0996\u09be\u0993\u09af\u09bc\u09be\u09b0 \u0995\u09b0\u09c1\u09a8\u0964",
            "\u0998\u09a3 \u0998\u09a3 \u09ac\u09ae\u09bf \u09b9\u09b2\u09c7 \u0993\u0986\u09b0\u098f\u09b8 \u09aa\u09be\u09a8 \u0995\u09b0\u09c1\u09a8\u0964"
        ],
        "selfCare_hi": [
            "\u092e\u0924\u0932\u0940 \u0915\u094b \u0930\u094b\u0915\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f \u0927\u0940\u0930\u0947-\u0927\u0940\u0930\u0947 \u0938\u093e\u092b \u0924\u0930\u0932 \u092a\u0926\u093e\u0930\u094d\u0925 \u092a\u093f\u090f\u0902\u0964",
            "\u0938\u093e\u0926\u093e \u0916\u093e\u0926\u094d\u092f \u092a\u0926\u093e\u0930\u094d\u0925 \u0916\u093e\u090f\u0902\u0964",
            "\u0913\u0906\u0930\u090f\u0938 \u0915\u093e \u0909\u092a\u092f\u094b\u0917 \u0915\u0930\u0947\u0902\u0964"
        ],
        "medicines": [
            {"name": "ORS (Oral Rehydration Salts)", "dose": "1 packet dissolved in 1L water, sip continuously", "note": "Prevents dehydration"},
            {"name": "Racecadotril 100mg", "dose": "1 capsule thrice daily before meals", "note": "Diarrhea control (max 3 days)"},
            {"name": "Probiotic Capsule", "dose": "1 capsule daily", "note": "Restores gut flora"}
        ],
        "medicines_bn": [
            {"name": "\u0993\u0986\u09b0\u098f\u09b8", "dose": "\u09e7 \u09b2\u09bf\u099f\u09be\u09b0 \u099c\u09b2\u09c7 \u09e7 \u09aa\u09cd\u09af\u09be\u0995\u09c7\u099f", "note": "\u099c\u09b2\u09c7\u09b0 \u0998\u09be\u099f\u09a4\u09bf \u09aa\u09c2\u09b0\u09a3\u09c7"},
            {"name": "\u09b0\u09c7\u09b8\u09bf\u0995\u09be\u09a1\u09cb\u099f\u09cd\u09b0\u09bf\u09b2 \u09e7\u09e6\u09e6\u09ae\u09bf\u0997\u09cd\u09b0\u09be", "dose": "\u0996\u09be\u09ac\u09be\u09b0\u09c7\u09b0 \u0986\u0997\u09c7 \u09a6\u09bf\u09a8\u09c7 \u09e9 \u09ac\u09be\u09b0 \u09e7\u099f\u09bf \u0995\u09cd\u09af\u09be\u09aa\u09b8\u09c1\u09b2", "note": "\u09a1\u09be\u09af\u09bc\u09b0\u09bf\u09af\u09bc\u09be \u09a8\u09bf\u09af\u09bc\u09a8\u09cd\u09a4\u09cd\u09b0\u09a3\u09c7"},
            {"name": "\u09aa\u09cd\u09b0\u09cb\u09ac\u09be\u09af\u09bc\u09cb\u099f\u09bf\u0995 \u0995\u09cd\u09af\u09be\u09aa\u09b8\u09c1\u09b2", "dose": "\u09aa\u09cd\u09b0\u09a4\u09bf\u09a6\u09bf\u09a8 \u09e7\u099f\u09bf \u0995\u09cd\u09af\u09be\u09aa\u09b8\u09c1\u09b2", "note": "\u0985\u09a8\u09cd\u09a4\u09cd\u09b0\u09c7\u09b0 \u09b8\u09cd\u09ac\u09be\u09b8\u09cd\u09a5\u09cd\u09af \u09ab\u09bf\u09b0\u09bf\u09af\u09bc\u09c7 \u0986\u09a8\u09a4\u09c7"}
        ],
        "medicines_hi": [
            {"name": "\u0913\u0906\u0930\u090f\u0938 \u0918\u094b\u0932", "dose": "1 \u0932\u0940\u091f\u0930 \u092a\u093e\u0928\u0940 \u092e\u0947\u0902 1 \u092a\u0948\u0915\u0947\u091f", "note": "\u0928\u093f\u0930\u094d\u091c\u0932\u0940\u0915\u0930\u0923 \u0938\u0947 \u092c\u091a\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f"},
            {"name": "\u0930\u0947\u0938\u093f\u0915\u093e\u0921\u094b\u091f\u094d\u0930\u093f\u0932 100mg", "dose": "\u092d\u094b\u091c\u0928 \u0938\u0947 \u092a\u0939\u0932\u0947 \u0926\u093f\u0928 \u092e\u0947\u0902 3 \u092c\u093e\u0930 1 \u0915\u0948\u092a\u094d\u0938\u0942\u0932", "note": "\u0926\u0938\u094d\u0924 \u0928\u093f\u092f\u0902\u0924\u094d\u0930\u0923"},
            {"name": "\u092a\u094d\u0930\u094b\u092c\u093e\u092f\u094b\u091f\u093f\u0915 \u0915\u0948\u092a\u094d\u0938\u0942\u0932", "dose": "\u0930\u094b\u091c\u093e\u0928\u093e 1 \u0915\u0948\u092a\u094d\u0938\u0942\u0932", "note": "\u0906\u0902\u0924\u094b\u0902 \u0915\u094b \u0920\u0940\u0915 \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f"}
        ]
    },
    {
        "id": "bronchitis",
        "name": "Acute Bronchitis",
        "name_bn": "\u09a4\u09c0\u09ac\u09cd\u09b0 \u09ac\u09cd\u09b0\u0999\u09cd\u0995\u09be\u0987\u099f\u09bf\u09b8",
        "name_hi": "\u0924\u0940\u0935\u094d\u0930 \u092c\u094d\u0930\u094b\u0902\u0915\u093e\u0907\u091f\u093f\u0938",
        "primary": ["cough", "shortness of breath", "shortness-breath", "wheezing"],
        "secondary": ["chest pain", "chest-pain", "fever"],
        "urgency": "medium",
        "specialist": "Pulmonologist",
        "specialist_bn": "\u09aa\u09be\u09b2\u09ae\u09cb\u09a8\u09cb\u09b2\u099c\u09bf\u09b8\u09cd\u099f",
        "specialist_hi": "\u092a\u0932\u094d\u092e\u094b\u0928\u094b\u0932\u0949\u091c\u093f\u0938\u094d\u091f",
        "explanation": "A pulmonologist specializes in lung health, helping manage severe coughs and ruling out pneumonia.",
        "explanation_bn": "\u098f\u0995\u099c\u09a8 \u09aa\u09be\u09b2\u09ae\u09cb\u09a8\u09cb\u09b2\u099c\u09bf\u09b8\u09cd\u099f \u09ab\u09c1\u09b8\u09ab\u09c1\u09b8\u09c7\u09b0 \u099a\u09bf\u0995\u09bf\u09ce\u09b8\u09be\u09af\u09bc \u09ac\u09bf\u09b6\u09c7\u09b7\u099c\u09cd\u099e\u0964",
        "explanation_hi": "\u090f\u0915 \u092a\u0932\u094d\u092e\u094b\u0928\u094b\u0932\u0949\u091c\u093f\u0938\u094d\u091f \u092b\u0947\u092b\u0921\u093c\u094b\u0902 \u0915\u0947 \u0938\u094d\u0935\u093e\u0938\u094d\u0925\u094d\u092f \u092e\u0947\u0902 \u0935\u093f\u0936\u0947\u0937\u091c\u094d\u091e\u0924\u093e \u0930\u0916\u0924\u093e \u0939\u0948\u0964",
        "desc": "Inflammation of the bronchial tubes causing bronchospasms and coughing fits.",
        "desc_bn": "\u09ac\u09cd\u09b0\u0999\u09cd\u0995\u09bf\u09af\u09bc\u09be\u09b2 \u099f\u09bf\u0989\u09ac\u09c7\u09b0 \u09b6\u09cd\u09b2\u09c7\u09b7\u09cd\u09ae\u09be \u099d\u09bf\u09b2\u09cd\u09b2\u09bf\u09b0 \u09aa\u09cd\u09b0\u09a6\u09be\u09b9\u0964",
        "desc_hi": "\u092c\u094d\u0930\u094b\u0902\u0915\u093f\u092f\u0932 \u0928\u0932\u093f\u092f\u094b\u0902 \u092e\u0947\u0902 \u0938\u094d\u0932\u0947\u0937\u094d\u092e\u093e \u091d\u093f\u0932\u094d\u0932\u0940 \u0915\u0940 \u0938\u0942\u091c\u0928\u0964",
        "selfCare": [
            "Use a cool-mist humidifier or inhale steam from a warm shower.",
            "Drink plenty of warm water or honey-water.",
            "Avoid tobacco smoke, dust, and air pollution."
        ],
        "selfCare_bn": [
            "\u0995\u09c1\u09b2-\u09ae\u09bf\u09b8\u09cd\u099f \u09b9\u09bf\u0989\u09ae\u09bf\u09a1\u09bf\u09ab\u09be\u09af\u09bc\u09be\u09b0 \u09ac\u09cd\u09af\u09ac\u09b9\u09be\u09b0 \u0995\u09b0\u09c1\u09a8 \u09ac\u09be \u0997\u09b0\u09ae \u099c\u09b2\u09c7\u09b0 \u09ad\u09be\u09aa \u09a8\u09bf\u09a8\u0964",
            "\u09aa\u09cd\u09b0\u099a\u09c1\u09b0 \u09a4\u09b0\u09b2 \u09aa\u09be\u09a8 \u0995\u09b0\u09c1\u09a8\u0964",
            "\u09a4\u09be\u09ae\u09be\u0995 \u09ac\u09be \u09a7\u09c1\u09a1\u09bc\u09be\u09ac\u09be\u09b2\u09bf \u098f\u09dc\u09bf\u09af\u09bc\u09c7 \u099a\u09b2\u09c1\u09a8\u0964"
        ],
        "selfCare_hi": [
            "\u0915\u0942\u0932-\u092e\u093f\u0938\u094d\u091f \u0939\u094d\u092f\u0942\u092e\u093f\u0921\u093f\u092b\u093e\u092f\u0930 \u0915\u093e \u0909\u092a\u092f\u094b\u0917 \u0915\u0930\u0947\u0902\u0964",
            "\u0917\u0941\u0928\u0917\u0941\u0928\u093e \u092a\u093e\u0928\u0940 \u092a\u093f\u090f\u0902\u0964",
            "\u0924\u0902\u092c\u093e\u0915\u0942 \u0938\u0947 \u092c\u091a\u0947\u0902\u0964"
        ],
        "medicines": [
            {"name": "Guaifenesin Syrup", "dose": "10 ml thrice daily", "note": "Loosens chest congestion and phlegm"},
            {"name": "Paracetamol 500mg", "dose": "1 tablet every 6-8 hours as needed", "note": "For fever & chest discomfort"},
            {"name": "Throat Lozenges", "dose": "Suck 1 lozenge every 3-4 hours", "note": "Soothes throat"}
        ],
        "medicines_bn": [
            {"name": "\u0997\u09c1\u09af\u09bc\u09be\u0987\u09ab\u09c7\u09a8\u09c7\u09b8\u09bf\u09a8 \u09b8\u09bf\u09b0\u09be\u09aa", "dose": "\u09a6\u09bf\u09a8\u09c7 \u09a4\u09bf\u09a8\u09ac\u09be\u09b0 \u09e7\u09e6 \u09ae\u09bf\u09b2\u09bf", "note": "\u09ac\u09c1\u0995\u09c7\u09b0 \u0995\u09ab \u09a8\u09b0\u09ae \u0995\u09b0\u09a4\u09c7"},
            {"name": "\u09aa\u09cd\u09af\u09be\u09b0\u09be\u09b8\u09bf\u099f\u09be\u09ae\u09b2 \u09eb\u09e6\u09e6\u09ae\u09bf\u0997\u09cd\u09b0\u09be", "dose": "\u09aa\u09cd\u09b0\u09af\u09bc\u09cb\u099c\u09a8 \u0985\u09a8\u09c1\u09af\u09be\u09af\u09bc\u09c0 \u09e7\u099f\u09bf \u099f\u09cd\u09af\u09be\u09ac\u09b2\u09c7\u099f", "note": "\u099c\u09cd\u09ac\u09b0 \u0993 \u09ac\u09c1\u0995\u09c7 \u0985\u09b8\u09cd\u09ac\u09b8\u09cd\u09a4\u09bf\u09a4\u09c7"},
            {"name": "\u0997\u09b2\u09be\u09b0 \u09b2\u099c\u09c7\u09a8\u09cd\u099c", "dose": "\u09aa\u09cd\u09b0\u09a4\u09bf \u09e9-\u09ea \u0998\u09a3\u09cd\u099f\u09be \u09aa\u09b0 \u09e7\u099f\u09bf", "note": "\u0997\u09b2\u09be \u0989\u09aa\u09b6\u09ae"}
        ],
        "medicines_hi": [
            {"name": "\u0917\u0941\u0907\u092b\u0947\u0928\u0947\u0938\u093f\u0928 \u0938\u093f\u0930\u092a", "dose": "\u0926\u093f\u0928 \u092e\u0947\u0902 \u0924\u0940\u0928 \u092c\u093e\u0930 10 \u092e\u093f\u0932\u0940", "note": "\u0938\u0940\u0928\u0947 \u0915\u0940 \u091c\u0915\u0921\u093c\u0928 \u0915\u094b \u0922\u0940\u0932\u093e \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f"},
            {"name": "\u092a\u0948\u0930\u093e\u0938\u093f\u091f\u093e\u092e\u094b\u0932 500mg", "dose": "\u0906\u0935\u0936\u094d\u092f\u0915\u0924\u093e\u0928\u0941\u0938\u093e\u0930 1 \u091f\u0948\u092c\u0932\u0947\u091f", "note": "\u092c\u0941\u0916\u093e\u0930 \u0914\u0930 \u0938\u0940\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f"},
            {"name": "\u0925\u094d\u0930\u094b\u091f \u0932\u0949\u091c\u0947\u0902\u091c\u0947\u0938", "dose": "\u0939\u0930 3-4 \u0918\u0902\u091f\u0947 \u092e\u0947\u0902 1", "note": "\u0917\u0932\u0947 \u0915\u094b \u0906\u0930\u093e\u092e \u0926\u0947\u0924\u093e \u0939\u0948"}
        ]
    },
    {
        "id": "angina",
        "name": "Cardiovascular Assessment (Angina/Cardiac Event)",
        "name_bn": "\u0995\u09be\u09b0\u09cd\u09a1\u09bf\u0993\u09ad\u09be\u09b8\u0995\u09c1\u09b2\u09be\u09b0 \u09ae\u09c2\u09b2\u09cd\u09af\u09be\u09af\u09bc\u09a8",
        "name_hi": "\u0939\u0943\u0926\u092f \u0938\u0902\u092c\u0902\u0927\u0940 \u092e\u0942\u0932\u094d\u092f\u093e\u0902\u0915\u0928",
        "primary": ["chest pain", "chest-pain", "palpitations", "shortness of breath", "shortness-breath"],
        "secondary": ["nausea", "dizziness", "headache"],
        "urgency": "urgent",
        "specialist": "Cardiologist",
        "specialist_bn": "\u0995\u09be\u09b0\u09cd\u09a1\u09bf\u0993\u09b2\u09cb\u099c\u09bf\u09b8\u09cd\u099f",
        "specialist_hi": "\u0915\u093e\u0930\u094d\u0921\u093f\u092f\u094b\u0932\u0949\u091c\u093f\u0938\u094d\u091f",
        "explanation": "A cardiologist handles acute coronary syndromes. Seek immediate emergency evaluation.",
        "explanation_bn": "\u098f\u0995\u099c\u09a8 \u0995\u09be\u09b0\u09cd\u09a1\u09bf\u0993\u09b2\u099c\u09bf\u09b8\u09cd\u099f \u09a4\u09c0\u09ac\u09cd\u09b0 \u0995\u09b0\u09cb\u09a8\u09be\u09b0\u09bf \u09b8\u09bf\u09a8\u09cd\u09a1\u09cd\u09b0\u09cb\u09ae \u099a\u09bf\u0995\u09bf\u09ce\u09b8\u09be \u0995\u09b0\u09c7\u09a8\u0964",
        "explanation_hi": "\u090f\u0915 \u0915\u093e\u0930\u094d\u0921\u093f\u092f\u094b\u0932\u0949\u091c\u093f\u0938\u094d\u091f \u0924\u0940\u0935\u094d\u0930 \u0915\u094b\u0930\u094b\u0928\u0930\u0940 \u0938\u093f\u0902\u0921\u094d\u0930\u094b\u092e \u0915\u093e \u092a\u094d\u0930\u092c\u0902\u0927\u0928 \u0915\u0930\u0924\u093e \u0939\u0948\u0964",
        "desc": "Coronary insufficiency or acute heart distress with oxygen deficit.",
        "desc_bn": "\u09b9\u09c3\u09a6\u09af\u09a8\u09cd\u09a4\u09cd\u09b0\u09c7\u09b0 \u09a7\u09ae\u09a8\u09c0\u09b0 \u09b0\u0995\u09cd\u09a4\u09b8\u09cd\u09ac\u09b2\u09cd\u09aa\u09a4\u09be\u0964",
        "desc_hi": "\u0915\u094b\u0930\u094b\u0928\u0930\u0940 \u0905\u092a\u0930\u094d\u092f\u093e\u092a\u094d\u0924\u0924\u093e \u092f\u093e \u0924\u0940\u0935\u094d\u0930 \u0939\u0943\u0926\u092f \u0938\u0902\u0915\u091f\u0964",
        "selfCare": [
            "Stop all physical exertion immediately. Sit or lie down in a comfortable position.",
            "Loosen collar buttons and tight clothing to ease breathing.",
            "If chest pain lasts > 5 mins or radiates to jaw/arm, call emergency services immediately."
        ],
        "selfCare_bn": [
            "\u0985\u09ac\u09bf\u09b2\u09ae\u09cd\u09ac\u09c7 \u09b8\u09ae\u09b8\u09cd\u09a4 \u09b6\u09be\u09b0\u09c0\u09b0\u09bf\u0995 \u09aa\u09b0\u09bf\u09b6\u09cd\u09b0\u09ae \u09ac\u09a8\u09cd\u09a7 \u0995\u09b0\u09c1\u09a8\u0964",
            "\u09b8\u09b9\u099c\u09c7 \u09b6\u09cd\u09ac\u09be\u09b8 \u09a8\u09bf\u09a4\u09c7 \u0997\u09b2\u09be\u09b0 \u09ac\u09cb\u09a4\u09be\u09ae \u0986\u09b2\u0997\u09be \u0995\u09b0\u09c1\u09a8\u0964",
            "\u09af\u09a6\u09bf \u09ac\u09c1\u0995\u09c7 5 \u09ae\u09bf\u09a8\u09bf\u099f\u09c7\u09b0 \u09ac\u09c7\u09b6\u09bf \u09ac\u09cd\u09af\u09a5\u09be \u09a5\u09be\u0995\u09c7 \u09a4\u09be\u09b9\u09b2\u09c7 \u0985\u09ac\u09bf\u09b2\u09ae\u09cd\u09ac\u09c7 \u098f\u09b8\u0993\u098f\u09b8 \u09a1\u09be\u0995\u09c1\u09a8\u0964"
        ],
        "selfCare_hi": [
            "\u0924\u0941\u0930\u0902\u0924 \u0938\u092d\u0940 \u0936\u093e\u0930\u0940\u0930\u093f\u0915 \u092a\u0930\u093f\u0936\u094d\u0930\u092e \u092c\u0902\u0926 \u0915\u0930 \u0926\u0947\u0902\u0964",
            "\u0938\u093e\u0901\u0938 \u0932\u0947\u0928\u0947 \u092e\u0947\u0902 \u0906\u0938\u093e\u0928\u0940 \u0915\u0947 \u0932\u093f\u090f \u0915\u0949\u0932\u0930 \u0922\u0940\u0932\u0947 \u0915\u0930\u0947\u0902\u0964",
            "\u092f\u0926\u093f \u091b\u093e\u0924\u0940 \u0915\u093e \u0926\u0930\u094d\u0926 5 \u092e\u093f\u0928\u091f \u0938\u0947 \u0905\u0927\u093f\u0915 \u0930\u0939\u0924\u093e \u0939\u0948 \u0924\u094b \u0924\u0941\u0930\u0902\u0924 \u0938\u0947\u0935\u093e\u0913\u0902 \u0938\u0947 \u0938\u0902\u092a\u0930\u094d\u0915 \u0915\u0930\u0947\u0902\u0964"
        ],
        "medicines": [
            {"name": "Aspirin 75mg", "dose": "1 tablet daily after meals", "note": "Consult cardiologist immediately"},
            {"name": "Nitroglycerin 0.5mg", "dose": "1 tablet sublingually under tongue (SOS)", "note": "For crushing chest pain - SEEK EMERGENCY CARE"},
            {"name": "Metoprolol 25mg", "dose": "1 tablet daily", "note": "Beta-blocker - consult cardiologist"}
        ],
        "medicines_bn": [
            {"name": "\u0985\u09cd\u09af\u09be\u09b8\u09aa\u09bf\u09b0\u09bf\u09a8 \u09ed\u09eb\u09ae\u09bf\u0997\u09cd\u09b0\u09be", "dose": "\u09aa\u09cd\u09b0\u09a4\u09bf\u09a6\u09bf\u09a8 \u09e7\u099f\u09bf \u099f\u09cd\u09af\u09be\u09ac\u09b2\u09c7\u099f", "note": "\u0995\u09be\u09b0\u09cd\u09a1\u09bf\u0993\u09b2\u099c\u09bf\u09b8\u09cd\u099f\u09c7\u09b0 \u09aa\u09b0\u09be\u09ae\u09b0\u09cd\u09b6 \u09a8\u09bf\u09a8"},
            {"name": "\u09a8\u09be\u0987\u099f\u09cd\u09b0\u09cb\u0997\u09cd\u09b2\u09bf\u09b8\u09be\u09b0\u09bf\u09a8 \u09e6.\u09eb\u09ae\u09bf\u0997\u09cd\u09b0\u09be", "dose": "\u099c\u09bf\u09ad\u09c7\u09b0 \u09a8\u09bf\u099a\u09c7 \u09e7\u099f\u09bf \u099f\u09cd\u09af\u09be\u09ac\u09b2\u09c7\u099f (\u09b8\u09cb\u09b8)", "note": "\u09a4\u09c0\u09ac\u09cd\u09b0 \u09ac\u09c1\u0995\u09c7 \u09ac\u09cd\u09af\u09a5\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u099c\u09b0\u09c1\u09b0\u09bf \u0993\u09b7\u09c1\u09a7"},
            {"name": "\u09ae\u09c7\u099f\u09cb\u09aa\u09cd\u09b0\u09cb\u09b2\u09b2 \u09e8\u09eb\u09ae\u09bf\u0997\u09cd\u09b0\u09be", "dose": "\u09aa\u09cd\u09b0\u09a4\u09bf\u09a6\u09bf\u09a8 \u09e7\u099f\u09bf \u099f\u09cd\u09af\u09be\u09ac\u09b2\u09c7\u099f", "note": "\u09aa\u09b0\u09be\u09ae\u09b0\u09cd\u09b6 \u09a8\u09bf\u09a8"}
        ],
        "medicines_hi": [
            {"name": "\u090f\u0938\u094d\u092a\u093f\u0930\u093f\u0928 75mg", "dose": "\u092d\u094b\u091c\u0928 \u0915\u0947 \u092c\u093e\u0926 \u0930\u094b\u091c\u093e\u0928\u093e 1 \u091f\u0948\u092c\u0932\u0947\u091f", "note": "\u0924\u0941\u0930\u0902\u0924 \u0939\u0943\u0926\u092f \u0930\u094b\u0917 \u0935\u093f\u0936\u0947\u0937\u091c\u094d\u091e \u0938\u0947 \u092e\u093f\u0932\u0947\u0902"},
            {"name": "\u0928\u093e\u0907\u091f\u094d\u0930\u094b\u0917\u094d\u0932\u093f\u0938\u0930\u0940\u0928 0.5mg", "dose": "\u091c\u0940\u092d \u0915\u0947 \u0928\u0940\u091a\u0947 1 \u091f\u0948\u092c\u0932\u0947\u091f", "note": "\u0906\u092a\u093e\u0924\u0915\u093e\u0932\u0940\u0928"},
            {"name": "\u092e\u0947\u091f\u094b\u092a\u094d\u0930\u094b\u0932\u094b\u0932 25mg", "dose": "\u0930\u094b\u091c\u093e\u0928\u093e 1 \u091f\u0948\u092c\u0932\u0947\u091f", "note": "\u0939\u0943\u0926\u092f \u0935\u093f\u0936\u0947\u0937\u091c\u094d\u091e \u0938\u0947 \u092a\u0930\u093e\u092e\u0930\u094d\u0936 \u0932\u0947\u0902"}
        ]
    }
]


@app.route('/api/diagnose', methods=['POST'])
def diagnose_api():
    data = request.json
    symptoms = data.get('symptoms', [])
    age = int(data.get('age', 28))
    gender = data.get('gender', 'Female')
    lang = data.get('lang', 'en')
    
    severity = int(data.get('severity', 2))
    duration = data.get('duration', 'few-days')
    risk_factors = data.get('riskFactors', {})
    
    matches = []
    
    # Check match for each condition in CONDITIONS_DB
    for cond in CONDITIONS_DB:
        score = 0
        matched_primary = 0
        matched_secondary = 0
        
        primary_lower = [p.lower() for p in cond['primary']]
        secondary_lower = [s.lower() for s in cond['secondary']]
        
        for sym in symptoms:
            sym_l = sym.lower()
            is_pri = any(p in sym_l or sym_l in p for p in primary_lower)
            is_sec = any(s in sym_l or sym_l in s for s in secondary_lower)
            if is_pri:
                score += 40
                matched_primary += 1
            elif is_sec:
                score += 15
                matched_secondary += 1
                
        total_possible = (len(cond['primary']) * 40) + (len(cond['secondary']) * 15)
        match_percent = min(100, round((score / total_possible) * 100)) if total_possible > 0 else 0
        
        if matched_primary > 0 and match_percent < 15:
            match_percent += 15
            
        if cond['id'] == 'angina' and any('chest' in sym.lower() for sym in symptoms):
            match_percent = max(match_percent, 60)
            if risk_factors.get('riskDiffBreathing'):
                match_percent += 15
                
        if (cond['id'] == 'bronchitis' or cond['id'] == 'flu') and risk_factors.get('riskDiffBreathing'):
            match_percent += 20
            
        match_percent = min(100, match_percent)
        
        if match_percent > 15:
            matches.append({
                'condition': {
                    'id': cond['id'],
                    'name': cond['name_bn'] if lang == 'bn' else (cond['name_hi'] if lang == 'hi' else cond['name']),
                    'description': cond['desc_bn'] if lang == 'bn' else (cond['desc_hi'] if lang == 'hi' else cond['desc']),
                    'baseUrgency': cond['urgency'],
                    'specialist': cond['specialist_bn'] if lang == 'bn' else (cond['specialist_hi'] if lang == 'hi' else cond['specialist']),
                    'specialistExplanation': cond['explanation_bn'] if lang == 'bn' else (cond['explanation_hi'] if lang == 'hi' else cond['explanation']),
                    'selfCare': cond['selfCare_bn'] if lang == 'bn' else (cond['selfCare_hi'] if lang == 'hi' else cond['selfCare'])
                },
                'percentage': match_percent
            })
            
    matches.sort(key=lambda x: x['percentage'], reverse=True)
    
    # If no matches or matches are weak
    if not matches or matches[0]['percentage'] < 25:
        # Dynamic keywords check
        has_respiratory = any(any(kw in s.lower() for kw in ['cough', 'breath', 'throat', 'wheez', 'nose', 'cold', 'সর্দি', 'কাশি', 'শ্বাস', 'গলা']) for s in symptoms)
        has_cardio = any(any(kw in s.lower() for kw in ['heart', 'chest', 'palpitation', 'cardiac', 'বুক', 'হৃদ']) for s in symptoms)
        has_gastro = any(any(kw in s.lower() for kw in ['stomach', 'nausea', 'vomit', 'bloat', 'acid', 'heartburn', 'digest', 'পেট', 'বমি']) for s in symptoms)
        has_neuro = any(any(kw in s.lower() for kw in ['headache', 'dizzy', 'migraine', 'brain', 'numb', 'মাথা', 'ঘোর']) for s in symptoms)
        has_skin = any(any(kw in s.lower() for kw in ['skin', 'rash', 'itch', 'spots', 'lesion', 'ত্বক', 'চুলকানি']) for s in symptoms)
        
        main_sym = symptoms[0] if symptoms else "Non-Specific Symptoms"
        
        if has_cardio:
            if lang == 'bn':
                cond_name = "কার্ডিওরেসপিরেটরি অস্বস্তি লক্ষণ"
                desc = f"আপনার নির্বাচিত লক্ষণসমূহ ({', '.join(symptoms)}) বুক ও হৃদযন্ত্রের উপর বর্ধিত চাপের ইঙ্গিত দেয়। কার্ডিওলজিস্টের পরামর্শ আবশ্যক।"
                specialist = "হৃদরোগ বিশেষজ্ঞ (কার্ডিওলজিস্ট)"
                explanation = "জরুরি কার্ডিওভাসকুলার মূল্যায়নের জন্য অবিলম্বে কার্ডিওলজিস্টের শরণাপন্ন হন।"
                self_care = ["সমস্ত শারীরিক পরিশ্রম বন্ধ করুন।", "আরামদায়ক স্থানে বসুন বা শুয়ে পড়ুন।", "চা, কফি বা অতিরিক্ত উদ্দীপক এড়িয়ে চলুন।"]
            elif lang == 'hi':
                cond_name = "हृदय और श्वसन संबंधी तनाव के लक्षण"
                desc = f"आपके चयनित लक्षण ({', '.join(symptoms)}) छाती या हृदय क्षेत्र में बढ़े हुए दबाव का संकेत देते हैं। नैदानिक मूल्यांकन आवश्यक है।"
                specialist = "हृदय रोग विशेषज्ञ (कार्डियोलॉजिस्ट)"
                explanation = "हृदय संबंधी तीव्र समस्याओं के तत्काल मूल्यांकन के लिए हृदय रोग विशेषज्ञ से मिलें।"
                self_care = ["शारीरिक परिश्रम तुरंत बंद करें।", "आरामदायक स्थिति में बैठें या लेट जाएं।", "उत्तेजक पेय या कैफीन से बचें।"]
            else:
                cond_name = "Cardiorespiratory Distress Indicators"
                desc = f"Your selected symptoms ({', '.join(symptoms)}) suggest physiological strain in the thoracic/cardiac systems."
                specialist = "Cardiologist"
                explanation = "A cardiologist evaluates acute coronary issues. Seek immediate emergency evaluation."
                self_care = ["Stop all physical exertion immediately.", "Rest in a comfortable, reclined position.", "Avoid caffeine, nicotine, and physical stress."]
            urgency = "urgent"
        elif has_respiratory:
            if lang == 'bn':
                cond_name = "শ্বাসনালী ও ফুসফুসের সংক্রমণ"
                desc = f"আপনার লক্ষণসমূহ ({', '.join(symptoms)}) শ্বাসনালীতে মিউকোসাল জ্বালাপোড়া বা ব্লকেজ নির্দেশ করে।"
                specialist = "পালমোনোলজিস্ট (ফুসফুস বিশেষজ্ঞ)"
                explanation = "পালমোনোলজিস্ট শ্বাসকষ্টের তীব্রতা নিরূপণ ও চিকিৎসার জন্য সেরা পরামর্শ দিতে পারেন।"
                self_care = ["গরম জলের ভাপ (স্টীম) নিন।", "পর্যাপ্ত উষ্ণ জল পান করুন।", "ধুলোবালি ও তামাকের ধোঁয়া থেকে দূরে থাকুন।"]
            elif lang == 'hi':
                cond_name = "श्वसन पथ में संकुलन"
                desc = f"आपके लक्षण ({', '.join(symptoms)}) श्वसन नलियों में जलन या संकुचन की ओर इशारा करते हैं।"
                specialist = "पल्मोनोलॉजिस्ट (फेफड़ों के डॉक्टर)"
                explanation = "एक पल्मोनोलॉजिस्ट फेफड़ों के गंभीर संक्रमण या सांस की बीमारी का इलाज करता है।"
                self_care = ["गर्म पानी की भाप लें।", "प्रचुर मात्रा में गुनगुना पानी पिएं।", "धूल और धुएं से दूर रहें।"]
            else:
                cond_name = "Respiratory Tract Congestion"
                desc = f"Your symptoms ({', '.join(symptoms)}) indicate mucosal irritation or airway congestion in the pulmonary tract."
                specialist = "Pulmonologist"
                explanation = "A pulmonologist evaluates pulmonary infections, bronchial blockages, or chronic asthma triggers."
                self_care = ["Inhale steam from a warm shower or humidifier.", "Stay hydrated with warm water.", "Avoid secondary cigarette smoke, dust, and pollen."]
            urgency = "medium" if risk_factors.get('riskDiffBreathing') else "low"
        elif has_gastro:
            if lang == 'bn':
                cond_name = "পাকস্থলীর প্রদাহ ও বদহজম"
                desc = f"লক্ষণসমূহ ({', '.join(symptoms)}) অন্ত্রের প্রদাহ বা এসিড রিফ্লাক্সের কারণে হচ্ছে বলে মনে হচ্ছে।"
                specialist = "গ্যাস্ট্রোএন্টারোলজিস্ট"
                explanation = "পেট ও অন্ত্রের দীর্ঘমেয়াদী সমস্যা মূল্যায়নে গ্যাস্ট্রোএন্টারোলজিস্ট সাহায্য করেন।"
                self_care = ["সহজপাচ্য এবং তেল-মসলাহীন খাবার খান।", "অল্প অল্প করে জল পান করুন।", "দুগ্ধজাত খাবার, ক্যাফেইন এবং ভাজা খাবার এড়িয়ে চলুন।"]
            elif lang == 'hi':
                cond_name = "जठरांत्र संबंधी सूजन या अपच"
                desc = f"आपके लक्षण ({', '.join(symptoms)}) पेट में संक्रमण या एसिड रिफ्लेक्स का संकेत देते हैं।"
                specialist = "गैस्ट्रोएंटेरोलॉजिस्ट"
                explanation = "पेट और आंतों से जुड़ी समस्याओं का मूल्यांकन करने के लिए गैस्ट्रोएंटेरोलॉजिस्ट से मिलें।"
                self_care = ["हल्का और सुपाच्य भोजन लें।", "धीरे-धीरे घूंट-घूंट करके पानी पिएं।", "मसालेदार और तैलीय भोजन से पूरी तरह बचें।"]
            else:
                cond_name = "Gastrointestinal Irritation / Dyspepsia"
                desc = f"Symptoms ({', '.join(symptoms)}) suggest mucosal inflammation or digestive tract acid reflux triggers."
                specialist = "Gastroenterologist"
                explanation = "A gastroenterologist handles gastrointestinal tract checks and diagnoses underlying digestive discomforts."
                self_care = ["Eat small, bland meals (e.g. BRAT diet).", "Stay hydrated with water or ORS solutions.", "Avoid heavy fats, dairy, spices, and caffeine."]
            urgency = "low"
        elif has_neuro:
            if lang == 'bn':
                cond_name = "স্নায়বিক মাথাব্যথা ও ক্লান্তি"
                desc = f"আপনার লক্ষণসমূহ ({', '.join(symptoms)}) মস্তিষ্কের রক্তনালীতে সংকুচিত চাপ বা সাধারণ মানসিক চাপের লক্ষণ।"
                specialist = "নিউরোলজিস্ট"
                explanation = "নিউরোলজিস্ট দীর্ঘস্থায়ী মাথাব্যথা ও স্নায়বিক রোগের সঠিক চিকিৎসা দিতে পারেন।"
                self_care = ["শান্ত এবং অন্ধকার ঘরে বিশ্রাম নিন।", "পর্যাপ্ত জল পান করুন।", "মোবাইল/কম্পিউটার স্ক্রিন থেকে দূরে থাকুন।"]
            elif lang == 'hi':
                cond_name = "न्यूरोलॉजिकल सिरदर्द और तनाव"
                desc = f"आपके लक्षण ({', '.join(symptoms)}) मस्तिष्क की रक्त वाहिकाओं में खिंचाव या तनाव का संकेत देते हैं।"
                specialist = "न्यूरोलॉजिस्ट"
                explanation = "पुराने सिरदर्द और तंत्रिका संबंधी रोगों के निदान के लिए न्यूरोलॉजिस्ट की सलाह लें।"
                self_care = ["एक शांत, अंधेरे कमरे में आराम करें।", "खूब पानी पिएं और निर्जलीकरण से बचें।", "स्क्रीन टाइम (मोबाइल/टीवी) को बिल्कुल कम करें।"]
            else:
                cond_name = "Neurovascular Strain / Tension Headache"
                desc = f"Symptoms ({', '.join(symptoms)}) indicate cerebral vascular constriction or severe tension strain."
                specialist = "Neurologist"
                explanation = "A neurologist evaluates chronic head pains, migraines, or localized nerve sensitivities."
                self_care = ["Rest in a quiet, dark room immediately.", "Apply a cool compress to the forehead.", "Decompress by staying away from screen monitors."]
            urgency = "low"
        elif has_skin:
            if lang == 'bn':
                cond_name = "ডার্মাটোলজিক্যাল অ্যালার্জি ও ত্বকের সংক্রমণ"
                desc = f"ত্বকে লাল দাগ বা লক্ষণসমূহ ({', '.join(symptoms)}) অ্যালার্জি বা ত্বকের কোনো সংক্রমণ নির্দেশ করে।"
                specialist = "চর্মরোগ বিশেষজ্ঞ (ডার্মাটোলজিস্ট)"
                explanation = "ডার্মাটোলজিস্ট ত্বকের সংক্রমণের কারণ এবং সে অনুযায়ী অ্যান্টি-ফাঙ্গাল বা অ্যান্টি-অ্যালার্জি মলম লিখে দেবেন।"
                self_care = ["ত্বক ঠান্ডা এবং শুষ্ক রাখুন।", "চুলকানো এড়িয়ে চলুন।", "কড়া সাবান বা পারফিউম ব্যবহার করবেন না।"]
            elif lang == 'hi':
                cond_name = "त्वचा की एलर्जी या त्वचा का संक्रमण"
                desc = f"त्वचा पर चकत्ते या लक्षण ({', '.join(symptoms)}) एलर्जी या किसी अन्य त्वचा संक्रमण की ओर इशारा करते हैं।"
                specialist = "त्वचा रोग विशेषज्ञ (डर्मेटोलॉजिस्ट)"
                explanation = "त्वचा की समस्याओं के सही निदान और मलहम आदि दवाओं के लिए त्वचा विशेषज्ञ से परामर्श लें।"
                self_care = ["त्वचा को ठंडा और सूखा रखें।", "प्रभावित जगह को खुजलाने से बचें।", "तेज सुगंध वाले साबुनों का उपयोग न करें।"]
            else:
                cond_name = "Dermatological Allergy / Inflammatory Rash"
                desc = f"Your skin indicators ({', '.join(symptoms)}) point towards epidermic irritation or allergic response."
                specialist = "Dermatologist"
                explanation = "A dermatologist specializes in resolving skin rashes, hives, eczema, or fungal infections."
                self_care = ["Keep the affected epidermal area cool and dry.", "Avoid scratching or rubbing the lesions.", "Apply calamine lotion or mild moisturizers without fragrance."]
            urgency = "low"
        else:
            if lang == 'bn':
                cond_name = f"অনির্দিষ্ট লক্ষণ বিশ্লেষণ ({main_sym})"
                desc = f"আপনার লক্ষণসমূহ ({', '.join(symptoms)}) একটি অনির্দিষ্ট প্রতিক্রিয়া। শারীরিক পরীক্ষা ও সঠিক মূল্যায়নের পরামর্শ দেওয়া হচ্ছে।"
                specialist = "জেনারেল ফিজিশিয়ান (জিপি)"
                explanation = "একজন জেনারেল ফিজিশিয়ান সাধারণ লক্ষণ ক্লাস্টার পরীক্ষা করে প্রাথমিক সমাধান দিতে পারেন।"
                self_care = ["পর্যাপ্ত বিশ্রাম নিন এবং প্রচুর জল পান করুন।", "লক্ষণগুলি বৃদ্ধি পাচ্ছে কিনা সেদিকে নজর রাখুন।", "অতিরিক্ত শারীরিক বা মানসিক চাপ এড়িয়ে চলুন।"]
            elif lang == 'hi':
                cond_name = f"गैर-विशिष्ट स्वास्थ्य लक्षण ({main_sym})"
                desc = f"आपके चयनित लक्षण ({', '.join(symptoms)}) किसी एक विशिष्ट बीमारी की ओर संकेत नहीं करते हैं। चिकित्सक से जांच कराएं।"
                specialist = "सामान्य चिकित्सक (जीपी)"
                explanation = "एक सामान्य चिकित्सक आपकी स्थिति का समग्र मूल्यांकन कर आवश्यक दवाएं या संदर्भ दे सकता है।"
                self_care = ["आराम करें, स्वस्थ आहार लें और पानी पिएं।", "अपने लक्षणों की अवधि और तीव्रता पर नज़र रखें।", "अधिक तनाव वाली गतिविधियों से बचें।"]
            else:
                cond_name = f"Physiological Response: {main_sym}"
                desc = f"Your selected symptoms ({', '.join(symptoms)}) present as a non-specific physiological response. Clinical review is advised."
                specialist = "General Practitioner"
                explanation = "A general practitioner evaluates overall wellness indicators and provides guidance or referrals."
                self_care = ["Prioritize rest and track changes in symptom patterns.", "Stay hydrated with 2-3 liters of fluids daily.", "Avoid strenuous workloads or secondary stressors."]
            urgency = "low"
            
        matches.insert(0, {
            'condition': {
                'id': 'custom-dynamic',
                'name': cond_name,
                'description': desc,
                'baseUrgency': urgency,
                'specialist': specialist,
                'specialistExplanation': explanation,
                'selfCare': self_care
            },
            'percentage': 85
        })

    # Urgency override
    final_urgency = 'low'
    has_high = any(m['condition']['baseUrgency'] == 'urgent' and m['percentage'] >= 45 for m in matches)
    has_med = any(m['condition']['baseUrgency'] == 'medium' and m['percentage'] >= 40 for m in matches)
    
    chest_pain_severe = any('chest' in s.lower() for s in symptoms) and severity == 3
    
    if has_high or risk_factors.get('riskDiffBreathing') or chest_pain_severe:
        final_urgency = 'urgent'
    elif has_med or severity == 3 or duration == '2w' or risk_factors.get('riskHighFever'):
        final_urgency = 'medium'

    report_id = str(random.randint(100000, 999999))
    report_data = {
        'id': report_id,
        'timestamp': datetime.datetime.now().isoformat(),
        'symptoms': symptoms,
        'demographics': { 'age': age, 'gender': gender },
        'settings': { 'severity': severity, 'duration': duration, 'riskFactors': risk_factors },
        'matches': matches[:3],
        'urgency': final_urgency
    }
    # Cache so prescription page works immediately without explicit "Save to History"
    _report_cache[report_id] = report_data
    return jsonify(report_data)


@app.route('/prescription/<report_id>')
@app.route('/api/prescription/<report_id>')
def view_prescription(report_id):
    return render_prescription_page(report_id, print_mode=False)

@app.route('/prescription/print/<report_id>')
@app.route('/api/prescription/print/<report_id>')
def print_prescription(report_id):
    return render_prescription_page(report_id, print_mode=True)

def render_prescription_page(report_id, print_mode=False):
    conn = get_db()
    row = conn.execute('SELECT report_json FROM diagnostics_history WHERE id = ?', (report_id,)).fetchone()
    profile = conn.execute('SELECT * FROM profile ORDER BY id DESC LIMIT 1').fetchone()
    conn.close()

    # Fall back to in-memory cache if not yet saved to DB
    if not row:
        if report_id in _report_cache:
            report = _report_cache[report_id]
        else:
            return "Prescription not found. Please run a diagnostic scan first and click Download Prescription.", 404
    else:
        report = json.loads(row['report_json'])
    
    # Extract details
    patient_name = profile['name'] if (profile and profile['name']) else "Sibsankar Maity"
    patient_age = str(profile['age']) + " Years" if (profile and profile['age']) else "19 Years"
    patient_gender = profile['gender'] if (profile and profile['gender']) else "Male"
    patient_id = f"AIH-2025-{report_id[:4].upper()}"
    
    # Parse date from timestamp
    date_str = "08 July 2025"
    try:
        dt = datetime.datetime.fromisoformat(report.get('timestamp', ''))
        date_str = dt.strftime("%d %B %Y")
    except Exception:
        pass
        
    symptoms = report.get('symptoms', [])
    matches = report.get('matches', [])
    
    # Generate list of medical advice, care, tips
    top_match = matches[0] if matches else None
    if top_match:
        cond_name = top_match['condition']['name']
        cond_desc = top_match['condition']['description']
        self_care = top_match['condition'].get('selfCare', [])
    else:
        cond_name = "General Assessment"
        cond_desc = "Clinical assessment for general symptom profile."
        self_care = ["Drink plenty of fluids.", "Ensure 8 hours of sleep.", "Rest and avoid stress."]
        
    # Standard lists
    medical_advice = [
        cond_desc,
        "Monitor your symptoms daily.",
        "Maintain proper ventilation in resting areas.",
        "If condition worsens or fails to improve within 3 days, consult a physician."
    ]
    
    recommended_care = self_care
    
    lifestyle_tips = [
        "Eat a healthy and balanced diet.",
        "Engage in light exercise or yoga.",
        "Practice meditation for stress relief.",
        "Maintain good hygiene and wash hands regularly.",
        "Stay positive and keep active."
    ]
    
    # QR Code URL pointing back to this digital prescription
    host = request.host
    qr_data = f"http://{host}/api/prescription/{report_id}"
    qr_code_url = f"https://api.qrserver.com/v1/create-qr-code/?size=130x130&data={qr_data}"
    
    # Emergency number from profile or fallback
    emergency_no = profile['medical_history'] if (profile and '8207' in str(profile.get('medical_history'))) else "8207004928"
    if not emergency_no or len(str(emergency_no)) < 5:
        emergency_no = "8207004928"
        
    # HTML Layout matching the image
    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Prescription & Health Advice - {patient_name}</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@1,600&display=swap" rel="stylesheet">
        <script src="https://unpkg.com/lucide@latest"></script>
        <style>
            :root {{
                --primary: #0f5132;
                --primary-light: #e8f5e9;
                --accent-blue: #0ea5e9;
                --text-main: #0f172a;
                --text-muted: #475569;
                --border-color: #cbd5e1;
            }}
            * {{
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }}
            body {{
                font-family: 'Outfit', sans-serif;
                background-color: #f1f5f9;
                color: var(--text-main);
                padding: 40px 20px;
                display: flex;
                justify-content: center;
            }}
            .prescription-card {{
                background: #ffffff;
                width: 100%;
                max-width: 800px;
                border-left: 20px solid var(--primary);
                border-right: 20px solid var(--primary);
                border-top: 1px solid #e2e8f0;
                border-bottom: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 40px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.05);
                position: relative;
                overflow: hidden;
            }}
            /* Header Styling */
            .header-section {{
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 2px solid #e2e8f0;
                padding-bottom: 25px;
                margin-bottom: 25px;
            }}
            .logo-block {{
                display: flex;
                align-items: center;
                gap: 12px;
            }}
            .logo-icon {{
                background: var(--primary-light);
                color: var(--primary);
                width: 50px;
                height: 50px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }}
            .logo-text {{
                display: flex;
                flex-direction: column;
            }}
            .logo-title {{
                font-size: 24px;
                font-weight: 800;
                color: var(--primary);
                letter-spacing: 0.5px;
            }}
            .logo-sub {{
                font-size: 10px;
                text-transform: uppercase;
                letter-spacing: 1.5px;
                color: var(--text-muted);
            }}
            .center-slogan {{
                text-align: center;
            }}
            .center-slogan h1 {{
                font-size: 32px;
                font-weight: 800;
                color: #0f172a;
            }}
            .center-slogan p {{
                font-size: 12px;
                color: var(--text-muted);
                margin-top: 4px;
            }}
            .pill-label {{
                background: var(--primary);
                color: #ffffff;
                padding: 8px 24px;
                border-radius: 30px;
                font-size: 14px;
                font-weight: 700;
                display: inline-block;
                text-align: center;
                margin: 15px auto;
                text-transform: uppercase;
                letter-spacing: 1px;
            }}
            
            /* Patient Details Grid */
            .patient-details-grid {{
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 15px;
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 20px;
                margin-bottom: 30px;
            }}
            .info-item {{
                display: flex;
                align-items: center;
                gap: 10px;
            }}
            .info-item i {{
                color: var(--primary);
                width: 20px;
                height: 20px;
            }}
            .info-text {{
                display: flex;
                flex-direction: column;
            }}
            .info-label {{
                font-size: 11px;
                color: var(--text-muted);
                text-transform: uppercase;
                font-weight: 500;
            }}
            .info-value {{
                font-size: 14px;
                font-weight: 600;
                color: var(--text-main);
            }}
            
            /* Columns Section */
            .content-columns {{
                display: grid;
                grid-template-columns: 1.2fr 1fr;
                gap: 30px;
                margin-bottom: 30px;
            }}
            .column-title {{
                font-size: 15px;
                font-weight: 700;
                text-transform: uppercase;
                color: var(--primary);
                border-bottom: 2px solid var(--primary-light);
                padding-bottom: 8px;
                margin-bottom: 15px;
            }}
            
            /* Possible Conditions */
            .condition-list {{
                display: flex;
                flex-direction: column;
                gap: 12px;
            }}
            .condition-item {{
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 12px 16px;
            }}
            .condition-left {{
                display: flex;
                align-items: center;
                gap: 12px;
            }}
            .condition-number {{
                background: var(--primary);
                color: #ffffff;
                width: 26px;
                height: 26px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: 700;
            }}
            .condition-name {{
                font-size: 14px;
                font-weight: 600;
            }}
            .condition-right {{
                text-align: right;
            }}
            .confidence-label {{
                font-size: 9px;
                color: var(--text-muted);
                text-transform: uppercase;
            }}
            .confidence-value {{
                font-size: 14px;
                font-weight: 700;
                color: var(--primary);
            }}
            
            /* Detected Symptoms */
            .symptoms-grid {{
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
            }}
            .symptom-item {{
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                font-weight: 500;
            }}
            .symptom-item i {{
                color: var(--primary);
                width: 16px;
                height: 16px;
            }}
            
            /* Three Blocks Advice Section */
            .advice-blocks {{
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 20px;
                margin-bottom: 30px;
            }}
            .advice-card {{
                border-radius: 8px;
                padding: 20px;
                border: 1px solid #e2e8f0;
            }}
            .advice-card.blue {{
                background: #f0f9ff;
                border-color: #bae6fd;
            }}
            .advice-card.green {{
                background: #f0fdf4;
                border-color: #bbf7d0;
            }}
            .advice-card.yellow {{
                background: #fefce8;
                border-color: #fef08a;
            }}
            .card-header {{
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 12px;
            }}
            .card-header i {{
                width: 18px;
                height: 18px;
            }}
            .advice-card.blue .card-header i {{ color: var(--accent-blue); }}
            .advice-card.green .card-header i {{ color: var(--primary); }}
            .advice-card.yellow .card-header i {{ color: #a16207; }}
            .card-title {{
                font-size: 12px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }}
            .card-bullets {{
                list-style: none;
            }}
            .card-bullets li {{
                font-size: 12px;
                line-height: 1.5;
                margin-bottom: 8px;
                position: relative;
                padding-left: 12px;
            }}
            .card-bullets li::before {{
                content: "•";
                position: absolute;
                left: 0;
                color: var(--text-muted);
            }}
            
            /* Footer Layout */
            .prescription-footer {{
                display: grid;
                grid-template-columns: 1.2fr 1fr 1fr;
                gap: 20px;
                border-top: 2px solid #e2e8f0;
                padding-top: 20px;
                align-items: start;
            }}
            .warning-box {{
                display: flex;
                flex-direction: column;
                gap: 10px;
            }}
            .warning-title {{
                font-size: 12px;
                font-weight: 700;
                color: #b91c1c;
                text-transform: uppercase;
                display: flex;
                align-items: center;
                gap: 6px;
            }}
            .warning-title i {{
                width: 16px;
                height: 16px;
            }}
            .warning-list {{
                list-style: none;
                font-size: 11px;
                color: var(--text-muted);
            }}
            .warning-list li {{
                margin-bottom: 4px;
                padding-left: 10px;
                position: relative;
            }}
            .warning-list li::before {{
                content: "•";
                color: #b91c1c;
                position: absolute;
                left: 0;
            }}
            .emergency-pill {{
                background: #b91c1c;
                color: #ffffff;
                border-radius: 30px;
                padding: 6px 12px;
                font-size: 12px;
                font-weight: 700;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                text-decoration: none;
                width: fit-content;
                margin-top: 6px;
            }}
            
            .follow-up-box {{
                font-size: 12px;
                color: var(--text-muted);
                line-height: 1.5;
            }}
            .follow-up-box strong {{
                color: var(--text-main);
            }}
            .care-badge {{
                display: flex;
                align-items: center;
                gap: 8px;
                margin-top: 15px;
                color: var(--primary);
                font-weight: 600;
                font-size: 12px;
            }}
            
            .scan-box {{
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
            }}
            .scan-title {{
                font-size: 10px;
                font-weight: 700;
                color: var(--primary);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 8px;
            }}
            .qr-code {{
                border: 2px solid var(--primary-light);
                padding: 4px;
                border-radius: 4px;
                background: #ffffff;
                width: 100px;
                height: 100px;
            }}
            .qr-code img {{
                width: 100%;
                height: 100%;
            }}
            
            .bottom-bar {{
                background: var(--primary);
                color: #ffffff;
                padding: 10px 40px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                width: 100%;
                max-width: 800px;
                border-bottom-left-radius: 8px;
                border-bottom-right-radius: 8px;
                margin: 0 auto;
                font-size: 10px;
            }}
            .bottom-slogan {{
                font-family: 'Playfair Display', serif;
                font-style: italic;
                font-size: 14px;
            }}
            .print-btn-container {{
                max-width: 800px;
                width: 100%;
                margin: 0 auto 20px auto;
                display: flex;
                justify-content: flex-end;
            }}
            .print-btn {{
                background: var(--primary);
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 4px;
                font-family: inherit;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
                transition: all 0.2s;
            }}
            .print-btn:hover {{
                opacity: 0.9;
                transform: translateY(-1px);
            }}

            @media print {{
                body {{
                    background: #ffffff;
                    padding: 0;
                }}
                .print-btn-container {{
                    display: none;
                }}
                .prescription-card {{
                    box-shadow: none;
                    border-radius: 0;
                    max-width: 100%;
                    width: 100%;
                    padding: 20px;
                }}
            }}
        </style>
    </head>
    <body>
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
            {"<div class='print-btn-container'><button class='print-btn' onclick='window.print()'><i data-lucide='printer'></i> Print / Download PDF</button></div>" if not print_mode else ""}
            
            <div class="prescription-card">
                <!-- Header -->
                <div class="header-section">
                    <div class="logo-block">
                        <div class="logo-icon">
                            <i data-lucide="plus-circle" style="width: 28px; height: 28px;"></i>
                        </div>
                        <div class="logo-text">
                            <span class="logo-title">AI_health</span>
                            <span class="logo-sub">Symptoms Checker</span>
                        </div>
                    </div>
                    
                    <div class="center-slogan">
                        <h1>AI_HEALTH</h1>
                        <p>Analyze • Understand • Stay Healthy</p>
                    </div>
                    
                    <div>
                        <svg width="80" height="40" viewBox="0 0 100 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M0 20h20l5-15l10 30l8-20l7 5h30" stroke="#198754" stroke-width="2" stroke-linejoin="round"/>
                        </svg>
                    </div>
                </div>
                
                <div style="text-align: center; width: 100%;">
                    <div class="pill-label">Prescription & Health Advice</div>
                </div>
                
                <!-- Patient details box -->
                <div class="patient-details-grid">
                    <div class="info-item">
                        <i data-lucide="user"></i>
                        <div class="info-text">
                            <span class="info-label">Patient Name</span>
                            <span class="info-value">{patient_name}</span>
                        </div>
                    </div>
                    <div class="info-item">
                        <i data-lucide="calendar"></i>
                        <div class="info-text">
                            <span class="info-label">Age</span>
                            <span class="info-value">{patient_age}</span>
                        </div>
                    </div>
                    <div class="info-item">
                        <i data-lucide="credit-card"></i>
                        <div class="info-text">
                            <span class="info-label">Patient ID</span>
                            <span class="info-value">{patient_id}</span>
                        </div>
                    </div>
                    <div class="info-item">
                        <i data-lucide="activity"></i>
                        <div class="info-text">
                            <span class="info-label">Gender</span>
                            <span class="info-value">{patient_gender}</span>
                        </div>
                    </div>
                    <div class="info-item">
                        <i data-lucide="clock"></i>
                        <div class="info-text">
                            <span class="info-label">Date</span>
                            <span class="info-value">{date_str}</span>
                        </div>
                    </div>
                    <div class="info-item">
                        <i data-lucide="shield-check"></i>
                        <div class="info-text">
                            <span class="info-label">Consultation Type</span>
                            <span class="info-value">AI Health Check</span>
                        </div>
                    </div>
                </div>
                
                <!-- Column report details -->
                <div class="content-columns">
                    <!-- Left: Possible Conditions -->
                    <div>
                        <div class="column-title">Possible Conditions</div>
                        <div class="condition-list">
    """
    
    for idx, match in enumerate(matches[:3]):
        num_str = f"0{idx+1}"
        cond_row = f"""
                            <div class="condition-item">
                                <div class="condition-left">
                                    <div class="condition-number">{num_str}</div>
                                    <div class="condition-name">{match['condition']['name']}</div>
                                </div>
                                <div class="condition-right">
                                    <div class="confidence-label">Confidence</div>
                                    <div class="confidence-value">{match['percentage']}%</div>
                                </div>
                            </div>
        """
        html_content += cond_row
        
    html_content += f"""
                        </div>
                    </div>
                    
                    <!-- Right: Detected Symptoms -->
                    <div>
                        <div class="column-title">Detected Symptoms</div>
                        <div class="symptoms-grid">
    """
    
    for sym in symptoms:
        sym_row = f"""
                            <div class="symptom-item">
                                <i data-lucide="check-circle-2"></i>
                                <span>{sym}</span>
                            </div>
        """
        html_content += sym_row
        
    html_content += f"""
                        </div>
                    </div>
                </div>
                
                <!-- Three blocks section -->
                <div class="advice-blocks">
                    <!-- Medical Advice -->
                    <div class="advice-card blue">
                        <div class="card-header">
                            <i data-lucide="stethoscope"></i>
                            <span class="card-title">Medical Advice</span>
                        </div>
                        <ul class="card-bullets">
    """
    
    for adv in medical_advice:
        html_content += f"                            <li>{adv}</li>\n"
        
    html_content += f"""
                        </ul>
                    </div>
                    
                    <!-- Recommended Care -->
                    <div class="advice-card green">
                        <div class="card-header">
                            <i data-lucide="pill"></i>
                            <span class="card-title">Recommended Care</span>
                        </div>
                        <ul class="card-bullets">
    """
    
    for care in recommended_care:
        html_content += f"                            <li>{care}</li>\n"
        
    html_content += f"""
                        </ul>
                    </div>
                    
                    <!-- Lifestyle Tips -->
                    <div class="advice-card yellow">
                        <div class="card-header">
                            <i data-lucide="heart"></i>
                            <span class="card-title">Lifestyle Tips</span>
                        </div>
                        <ul class="card-bullets">
    """
    
    for tip in lifestyle_tips:
        html_content += f"                            <li>{tip}</li>\n"
        
    html_content += f"""
                        </ul>
                    </div>
                </div>
                
                <!-- Footer area -->
                <div class="prescription-footer">
                    <!-- Warning signs -->
                    <div class="warning-box">
                        <div class="warning-title">
                            <i data-lucide="alert-triangle"></i>
                            <span>Warning Signs</span>
                        </div>
                        <ul class="warning-list">
                            <li>High fever (Above 102°F)</li>
                            <li>Difficulty in breathing</li>
                            <li>Chest pain or chest pressure</li>
                            <li>Severe headache or sudden confusion</li>
                            <li>Persistent vomiting</li>
                        </ul>
                        <a href="tel:{emergency_no}" class="emergency-pill">
                            <i data-lucide="phone"></i>
                            <span>EMERGENCY: {emergency_no}</span>
                        </a>
                    </div>
                    
                    <!-- Follow up -->
                    <div class="follow-up-box">
                        <div class="warning-title" style="color: var(--text-main);">
                            <i data-lucide="calendar-days" style="color: var(--primary);"></i>
                            <span>Follow Up</span>
                        </div>
                        <div style="margin-top: 10px; font-size: 11px;">
                            If symptoms do not improve within <strong>3-4 days</strong>, or if they get worse, please consult a medical doctor.
                        </div>
                        <div class="care-badge">
                            <i data-lucide="heart-pulse"></i>
                            <span>AI Health Team</span>
                        </div>
                    </div>
                    
                    <!-- QR Scanner code -->
                    <div class="scan-box">
                        <div class="scan-title">Scan For More Info</div>
                        <div class="qr-code">
                            <img src="{qr_code_url}" alt="Digital Prescription Link QR Code">
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Bottom banner bar -->
            <div class="bottom-bar">
                <div style="max-width: 60%;">
                    Disclaimer: This is an AI-generated suggestion, not a substitute for professional medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider.
                </div>
                <div class="bottom-slogan">
                    Stay Healthy, Stay Happy! <i data-lucide="heart" style="width: 12px; height: 12px; display: inline-block; fill: red; stroke: red; vertical-align: middle;"></i>
                </div>
            </div>
        </div>
        
        <script>
            lucide.createIcons();
            {"window.onload = () => { setTimeout(() => { window.print(); }, 500); }" if print_mode else ""}
        </script>
    </body>
    </html>
    """
    return html_content

if __name__ == '__main__':
    init_db()
    # Runs locally on port 5000
    app.run(host='127.0.0.1', port=5000, debug=True)
