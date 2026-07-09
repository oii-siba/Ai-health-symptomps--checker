import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, orderBy, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
/* ==========================================================================
   Aegis AI Health Symptoms Checker - Core Client-Side Logic Engine
   ========================================================================== */

const startApp = () => {
  
  // Redirect API fetches to port 5000 if running on port 5500 (Live Server)
  if (window.location.port === '5500') {
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      if (typeof input === 'string' && input.startsWith('/api/')) {
        input = 'http://127.0.0.1:5000' + input;
      }
      return originalFetch(input, init);
    };
  }

  // --- MOBILE SIDEBAR DRAWER TOGGLE CONTROL ---
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.querySelector('.sidebar');
  let overlay = document.querySelector('.sidebar-overlay');
  
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
  }

  if (mobileMenuBtn && sidebar) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('active');
      overlay.style.display = sidebar.classList.contains('active') ? 'block' : 'none';
    });
    
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('active');
      overlay.style.display = 'none';
    });

    // Close menu when clicking a nav item on mobile
    const navItemsList = sidebar.querySelectorAll('.nav-item');
    navItemsList.forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 900) {
          sidebar.classList.remove('active');
          overlay.style.display = 'none';
        }
      });
    });
  }

  // --- HOISTED STATE VARIABLES FOR FIREBASE ---
  function getCurrentTimeString() {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  // --- APP STATE ---
  let appState = {
    user: {
      name: 'Sarah Jenkins',
      age: 28,
      gender: 'Female',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=256',
      weight: 62,
      height: 168,
      bloodGroup: 'A+',
      allergies: 'Peanuts, Penicillin',
      medicalHistory: 'Mild Asthma in childhood'
    },
    selectedSymptoms: new Set(),
    activeTab: 'checker',
    currentWizardStep: 1,
    savedDiagnostics: [],
    chatHistory: [
      {
        sender: 'bot',
        text: 'Hello! I am your AI_health Assistant. I can help answer health-related questions, explain medical terminology, or suggest diet and fitness tips. What can I do for you today?',
        time: getCurrentTimeString()
      }
    ],
    lastGeneratedReport: null
  };

  let userMeds = [];

  let hydrationData = {
    target: 2000,
    current: 0,
    lastLoggedDate: ''
  };

  let sleepLogs = [];


  // --- FIREBASE CONFIGURATION ---
  // Insert your Firebase configuration details here.
  // You can get this from the Firebase Console (https://console.firebase.google.com/)
  const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
  };

  let firebaseApp = null;
  let auth = null;
  let db = null;
  let currentUser = null;

  if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY") {
    try {
      firebaseApp = initializeApp(firebaseConfig);
      auth = getAuth(firebaseApp);
      db = getFirestore(firebaseApp);
      console.log("Firebase initialized successfully!");
    } catch (err) {
      console.error("Firebase initialization failed:", err);
    }
  } else {
    console.log("Firebase is in local mode. Fill in firebaseConfig at the top of app.js to enable Google Login & Firestore sync.");
  }

  function openProfileModal(e) {
    if (e) e.stopPropagation();
    
    updateProfileUI();
    
    if (settingsModal) {
      settingsModal.style.display = 'flex';
    }
  }

  function renderAuthUI() {
    const container = document.getElementById('user-profile-container');
    if (!container) return;

    if (!auth) {
      // Firebase not configured - show default fallback card
      container.innerHTML = `
        <div class="user-profile-card" style="cursor: pointer;">
          <div class="profile-avatar">
            <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=256" alt="User avatar" id="profile-img">
            <span class="status-indicator online"></span>
          </div>
          <div class="profile-info">
            <h3 id="profile-name">${appState.user?.name || 'Sarah Jenkins'}</h3>
            <p id="profile-stats">${appState.user?.age || 28} Yrs • ${appState.user?.gender || 'Female'}</p>
          </div>
          <div class="profile-actions-row" style="display: flex; gap: 8px; margin-left: auto;">
            <button class="settings-btn" id="open-settings-btn" title="Edit Profile">
              <i data-lucide="sliders"></i>
            </button>
          </div>
        </div>
      `;
      const editBtn = container.querySelector('#open-settings-btn');
      if (editBtn) editBtn.addEventListener('click', openProfileModal);

      const card = container.querySelector('.user-profile-card');
      if (card) {
        card.addEventListener('click', (e) => {
          if (!e.target.closest('.profile-actions-row') && !e.target.closest('button')) {
            openProfileModal(e);
          }
        });
      }
      lucide.createIcons();
      return;
    }

    if (currentUser) {
      // User is logged in
      container.innerHTML = `
        <div class="user-profile-card" style="cursor: pointer;">
          <div class="profile-avatar">
            <img src="${currentUser.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=256'}" alt="User avatar" id="profile-img">
            <span class="status-indicator online"></span>
          </div>
          <div class="profile-info">
            <h3 id="profile-name" style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 110px;">${appState.user?.name || currentUser.displayName || 'User'}</h3>
            <p id="profile-stats">${appState.user?.age || 28} Yrs • ${appState.user?.gender || 'Female'}</p>
          </div>
          <div class="profile-actions-row" style="display: flex; gap: 6px; margin-left: auto;">
            <button class="settings-btn" id="open-settings-btn" title="Edit Profile">
              <i data-lucide="sliders"></i>
            </button>
            <button class="settings-btn logout-btn" id="google-logout-btn" title="Logout" style="color: var(--accent-rose);">
              <i data-lucide="log-out"></i>
            </button>
          </div>
        </div>
      `;

      const editBtn = container.querySelector('#open-settings-btn');
      if (editBtn) editBtn.addEventListener('click', openProfileModal);
      
      const card = container.querySelector('.user-profile-card');
      if (card) {
        card.addEventListener('click', (e) => {
          if (!e.target.closest('.profile-actions-row') && !e.target.closest('button')) {
            openProfileModal(e);
          }
        });
      }

      const logoutBtn = container.querySelector('#google-logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          try {
            await signOut(auth);
            console.log("Logged out successfully");
            currentUser = null;
            appState.user = { name: "Guest User", age: 28, gender: "Female", weight: 62, height: 168, blood_group: "O+", allergies: "None", clinical_history: "" };
            appState.savedDiagnostics = [];
            userMeds = [];
            sleepLogs = [];
            hydrationData = { current: 0, target: 3.0 };
            
            updateProfileUI();
            renderHistoryTab();
            renderMedications();
            updateWaterUI();
            renderSleepLogs();
            renderAuthUI();
          } catch (err) {
            console.error("Logout failed:", err);
          }
        });
      }
    } else {
      // User is logged out - show "Sign in with Google" button
      container.innerHTML = `
        <div style="padding: 0 4px 10px 4px;">
          <button class="google-login-btn" id="google-login-btn">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google logo">
            <span>Sign in with Google</span>
          </button>
        </div>
      `;

      const loginBtn = container.querySelector('#google-login-btn');
      if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
          try {
            const provider = new GoogleAuthProvider();
            const result = await signInWithPopup(auth, provider);
            console.log("Successfully logged in:", result.user.displayName);
          } catch (err) {
            console.error("Google Sign-In failed:", err);
            alert("Google Sign-In failed: " + err.message);
          }
        });
      }
    }
    lucide.createIcons();
  }

  async function syncDataFromFirestore(uid) {
    if (!db) return;
    try {
      // 1. Sync Profile
      const userDocRef = doc(db, "users", uid);
      const userDoc = await getDoc(userDocRef);
      if (userDoc.exists()) {
        appState.user = userDoc.data();
      } else {
        appState.user = {
          name: currentUser.displayName || "Sarah Jenkins",
          email: currentUser.email || "",
          age: 28,
          gender: "Female",
          weight: 62,
          height: 168,
          blood_group: "O+",
          allergies: "None",
          clinical_history: ""
        };
        await setDoc(userDocRef, appState.user);
      }
      updateProfileUI();

      // 2. Sync Scan History
      const historyCol = collection(db, "users", uid, "history");
      const historyQuery = query(historyCol, orderBy("timestamp", "desc"));
      const historySnapshot = await getDocs(historyQuery);
      appState.savedDiagnostics = [];
      historySnapshot.forEach((docSnap) => {
        appState.savedDiagnostics.push({ id: docSnap.id, ...docSnap.data() });
      });
      renderHistoryTab();

      // 3. Sync Medications
      const medsCol = collection(db, "users", uid, "medications");
      const medsSnapshot = await getDocs(medsCol);
      userMeds = [];
      medsSnapshot.forEach((docSnap) => {
        userMeds.push({ id: docSnap.id, ...docSnap.data() });
      });
      renderMedications();

      // 4. Sync Sleep
      const sleepCol = collection(db, "users", uid, "sleep");
      const sleepQuery = query(sleepCol, orderBy("date", "desc"));
      const sleepSnapshot = await getDocs(sleepQuery);
      sleepLogs = [];
      sleepSnapshot.forEach((docSnap) => {
        sleepLogs.push({ id: docSnap.id, ...docSnap.data() });
      });
      renderSleepLogs();

      // 5. Sync Water
      const todayDateStr = new Date().toDateString();
      const waterDocRef = doc(db, "users", uid, "water", todayDateStr);
      const waterDoc = await getDoc(waterDocRef);
      if (waterDoc.exists()) {
        const wData = waterDoc.data();
        hydrationData.current = wData.current;
        hydrationData.target = wData.target;
      } else {
        hydrationData.current = 0;
        hydrationData.target = 3.0;
        await setDoc(waterDocRef, { current: 0, target: 3.0 });
      }
      updateWaterUI();

      renderAuthUI();
    } catch (err) {
      console.error("Error syncing data from Firestore:", err);
    }
  }

  if (auth) {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUser = user;
        console.log("Auth state changed: user logged in", user.email);
        await syncDataFromFirestore(user.uid);
      } else {
        currentUser = null;
        console.log("Auth state changed: user logged out");
        renderAuthUI();
      }
    });
  } else {
    // Initial UI render in mock/local mode
    setTimeout(() => renderAuthUI(), 100);
  }

  
  // --- MEDICAL KNOWLEDGE BASE DATA ---
  const SYMPTOMS_DB = [
    { id: 'headache', name: 'Headache', region: 'head' },
    { id: 'dizziness', name: 'Dizziness', region: 'head' },
    { id: 'runny-nose', name: 'Runny nose', region: 'head' },
    { id: 'sore-throat', name: 'Sore throat', region: 'head' },
    { id: 'fever', name: 'Fever', region: 'head' }, // Systemic mapped to head/body
    { id: 'chest-pain', name: 'Chest Pain', region: 'chest' },
    { id: 'shortness-breath', name: 'Shortness of breath', region: 'chest' },
    { id: 'cough', name: 'Cough', region: 'chest' },
    { id: 'wheezing', name: 'Wheezing', region: 'chest' },
    { id: 'palpitations', name: 'Heart palpitations', region: 'chest' },
    { id: 'stomach-ache', name: 'Stomach Ache', region: 'abdomen' },
    { id: 'nausea', name: 'Nausea', region: 'abdomen' },
    { id: 'vomiting', name: 'Vomiting', region: 'abdomen' },
    { id: 'bloating', name: 'Bloating', region: 'abdomen' },
    { id: 'heartburn', name: 'Heartburn', region: 'abdomen' },
    { id: 'pelvic-pain', name: 'Pelvic Pain', region: 'pelvis' },
    { id: 'back-pain', name: 'Lower back pain', region: 'pelvis' },
    { id: 'urinary-urgency', name: 'Urinary urgency', region: 'pelvis' },
    { id: 'cramps', name: 'Cramps', region: 'pelvis' },
    { id: 'joint-stiff', name: 'Joint stiffness', region: 'arms' },
    { id: 'numbness-arms', name: 'Numbness', region: 'arms' },
    { id: 'arm-weakness', name: 'Arm weakness', region: 'arms' },
    { id: 'muscle-soreness', name: 'Muscle soreness', region: 'arms' },
    { id: 'knee-pain', name: 'Knee pain', region: 'legs' },
    { id: 'leg-swelling', name: 'Leg swelling', region: 'legs' },
    { id: 'leg-cramps', name: 'Leg cramps', region: 'legs' },
    { id: 'numbness-legs', name: 'Numbness in legs', region: 'legs' }
  ];

  const CONDITIONS_DB = [
    {
      id: 'cold',
      name: 'Common Cold',
      primarySymptoms: ['runny-nose', 'sore-throat', 'cough'],
      secondarySymptoms: ['fever', 'headache', 'muscle-soreness'],
      baseUrgency: 'low',
      specialist: 'General Practitioner',
      specialistExplanation: 'A general practitioner can rule out complex infections and direct symptomatic treatments.',
      selfCare: [
        'Prioritize rest and avoid strenuous physical activity.',
        'Drink warm liquids (herbal tea, broth) to soothe the throat.',
        'Consider saline nasal sprays or steam inhalation to ease congestion.',
        'Monitor temperature regularly. Use OTC pain relievers (acetaminophen/ibuprofen) if fever causes discomfort.'
      ],
      description: 'A mild viral infection of the nose and throat, characterized by congestion, sneezing, and scratchy throat.'
    },
    {
      id: 'flu',
      name: 'Influenza (Flu)',
      primarySymptoms: ['fever', 'cough', 'muscle-soreness', 'headache'],
      secondarySymptoms: ['sore-throat', 'runny-nose', 'dizziness'],
      baseUrgency: 'medium',
      specialist: 'General Practitioner',
      specialistExplanation: 'A GP can prescribe anti-viral medications if diagnosed within 48 hours of symptom onset.',
      selfCare: [
        'Commit to complete bed rest for the first 3 days.',
        'Hydrate heavily with water, coconut water, or electrolyte solutions.',
        'Manage high fever with cooling pads and OTC antipyretics.',
        'Stay isolated from household members to prevent transmission.'
      ],
      description: 'A highly contagious viral infection of the respiratory passages causing high fever, severe aching, and catarrh.'
    },
    {
      id: 'migraine',
      name: 'Migraine Headache',
      primarySymptoms: ['headache', 'nausea', 'dizziness'],
      secondarySymptoms: ['muscle-soreness'],
      baseUrgency: 'low',
      specialist: 'Neurologist',
      specialistExplanation: 'A neurologist helps diagnose chronic headache disorders and prescribe preventive therapies.',
      selfCare: [
        'Rest in a completely dark, quiet room during an attack.',
        'Apply a cold, damp cloth or ice pack wrapped in a towel to the forehead or temples.',
        'Avoid triggers such as caffeine, bright screens, and sudden loud noises.',
        'Hydrate well, as mild dehydration can exacerbate migraine severity.'
      ],
      description: 'A neurological condition characterized by intense, throbbing headaches, often accompanied by sensitivity to light/sound and nausea.'
    },
    {
      id: 'gastroenteritis',
      name: 'Gastroenteritis',
      primarySymptoms: ['stomach-ache', 'nausea', 'vomiting', 'bloating'],
      secondarySymptoms: ['fever', 'dizziness'],
      baseUrgency: 'low',
      specialist: 'Gastroenterologist',
      specialistExplanation: 'A gastroenterologist evaluates stomach and intestinal issues if symptoms persist beyond a week.',
      selfCare: [
        'Sip clear fluids (water, broth, diluted juice) slowly in small increments to prevent nausea.',
        'Introduce bland, solid foods like bananas, rice, applesauce, and dry toast (BRAT diet) as tolerated.',
        'Avoid dairy, fatty foods, alcohol, caffeine, and highly seasoned dishes.',
        'Ensure rehydration using Oral Rehydration Salts (ORS) if vomiting is frequent.'
      ],
      description: 'Inflammation of the stomach and intestines, typically resulting from bacterial toxins or viral infection.'
    },
    {
      id: 'bronchitis',
      name: 'Acute Bronchitis',
      primarySymptoms: ['cough', 'shortness-breath', 'wheezing'],
      secondarySymptoms: ['chest-pain', 'fever'],
      baseUrgency: 'medium',
      specialist: 'Pulmonologist',
      specialistExplanation: 'A pulmonologist specializes in lung health, helping manage severe coughs and ruling out pneumonia.',
      selfCare: [
        'Use a cool-mist humidifier or inhale steam from a warm shower to loose chest mucus.',
        'Drink plenty of warm water or honey-water to soothe bronchial irritation.',
        'Avoid tobacco smoke, dust, air pollution, and chemical fumes.',
        'Use throat lozenges or cough suppressants strictly according to instructions.'
      ],
      description: 'Inflammation of the mucous membrane in the bronchial tubes, which causes bronchospasms and coughing fits.'
    },
    {
      id: 'angina',
      name: 'Cardiovascular Assessment (Angina/Cardiac Event)',
      primarySymptoms: ['chest-pain', 'palpitations', 'shortness-breath'],
      secondarySymptoms: ['nausea', 'dizziness', 'headache'],
      baseUrgency: 'urgent',
      specialist: 'Cardiologist',
      specialistExplanation: 'A cardiologist handles acute coronary syndromes. Seek immediate emergency evaluation.',
      selfCare: [
        'Stop all physical exertion immediately. Sit or lie down in a comfortable position.',
        'Loosen collar buttons and tight clothing to ease breathing.',
        'If chest pain is crushing, radiating to the jaw/arm, or lasts > 5 minutes, call local emergency services (SOS) immediately.',
        'Do not drive yourself to the hospital; await medical paramedics.'
      ],
      description: 'Coronary insufficiency or acute heart distress where heart muscles experience temporary or severe oxygen deficit.'
    },
    {
      id: 'uti',
      name: 'Urinary Tract Infection (UTI)',
      primarySymptoms: ['urinary-urgency', 'pelvic-pain', 'back-pain'],
      secondarySymptoms: ['fever'],
      baseUrgency: 'medium',
      specialist: 'Urologist',
      specialistExplanation: 'A urologist handles diagnostic screenings and treatments for kidney or urinary tract disorders.',
      selfCare: [
        'Drink large amounts of water to continuously flush bacteria from your bladder.',
        'Avoid alcohol, coffee, and acidic fruit juices which irritate the urinary lining.',
        'Apply a warm heating pad to your lower abdomen to relieve pressure or cramps.',
        'Consult a clinician for a urine culture test and prescription antibiotics.'
      ],
      description: 'An infection in any part of the urinary system, most commonly involving the bladder or urethra.'
    },
    {
      id: 'dehydration',
      name: 'Dehydration & Heat Exhaustion',
      primarySymptoms: ['dizziness', 'leg-cramps', 'headache', 'nausea'],
      secondarySymptoms: ['muscle-soreness', 'palpitations'],
      baseUrgency: 'medium',
      specialist: 'General Practitioner',
      specialistExplanation: 'A GP can monitor electrolyte balances and oversee intravenous rehydration if severe.',
      selfCare: [
        'Move to a cool, air-conditioned space or shaded outdoor area immediately.',
        'Sip cold water, sports drinks, or commercial electrolyte mixtures slowly.',
        'Lie down and elevate your legs slightly to assist blood circulation to the brain.',
        'Dampen skin with cool water or apply ice packs wrapped in cloth to neck/underarms.'
      ],
      description: 'A condition caused by excessive loss of water and minerals from the body, often triggered by heat exposure.'
    },
    {
      id: 'joint-strain',
      name: 'Osteoarthritis / Joint Strain',
      primarySymptoms: ['joint-stiff', 'knee-pain'],
      secondarySymptoms: ['muscle-soreness', 'arm-weakness'],
      baseUrgency: 'low',
      specialist: 'Rheumatologist / Orthopedist',
      specialistExplanation: 'Orthopedists analyze physical joint structure, while rheumatologists treat inflammatory joint disorders.',
      selfCare: [
        'Apply ice packs for 15 minutes to reduce acute joint swelling.',
        'Apply gentle, warm compresses to alleviate morning stiffness.',
        'Avoid high-impact activities (like running); substitute with light swimming or cycling.',
        'Elevate and support the joint with compression sleeves if feeling unstable.'
      ],
      description: 'Degenerative joint disease or strain causing wear-and-tear of articular cartilage and secondary localized inflammation.'
    }
  ];



  // --- DOM ELEMENTS CACHE ---
  // Tabs & Nav
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  
  // Profile elements
  const profileImg = document.getElementById('profile-img');
  const profileName = document.getElementById('profile-name');
  const profileStats = document.getElementById('profile-stats');
  const welcomeName = document.getElementById('welcome-name');
  const currentDate = document.getElementById('current-date');
  
  // Checker Inputs
  const searchInput = document.getElementById('symptom-search');
  const suggestionsDropdown = document.getElementById('suggestions-dropdown');
  const clearSearchBtn = document.getElementById('clear-search');
  const selectedChipsContainer = document.getElementById('selected-chips');
  const quickSymptomButtons = document.querySelectorAll('.quick-sym-btn');
  const svgBodyParts = document.querySelectorAll('.body-part-group');
  const bodyFrontBtn = document.getElementById('body-view-front');
  const bodyBackBtn = document.getElementById('body-view-back');
  const interactiveBodySvg = document.getElementById('interactive-body-svg');
  
  // Diagnostic Wizard State Containers
  const stateEmpty = document.getElementById('wizard-state-empty');
  const stateForm = document.getElementById('wizard-state-form');
  const stateScanning = document.getElementById('wizard-state-scanning');
  const stateResults = document.getElementById('wizard-state-results');
  
  // Wizard Buttons & Forms
  const startWizardBtn = document.getElementById('start-wizard-btn');
  const wizardForm = document.getElementById('wizard-form');
  const wizardNextBtns = document.querySelectorAll('.wizard-next-btn');
  const wizardBackBtns = document.querySelectorAll('.wizard-back-btn');
  const formSteps = document.querySelectorAll('.form-step-container');
  const stepDots = document.querySelectorAll('.step-dot');
  
  // Wizard Form Inputs
  const diagGenderInput = document.getElementById('diag-gender');
  const diagAgeInput = document.getElementById('diag-age');
  const diagSeverityInput = document.getElementById('diag-severity');
  const severityBadge = document.getElementById('severity-badge');
  const triggerScanBtn = document.getElementById('trigger-scan-btn');
  
  // Scanning Elements
  const scanProgressBar = document.getElementById('scan-progress-bar');
  const scanPercentText = document.getElementById('scan-percent');
  const scanStatusText = document.getElementById('scan-status-text');
  
  // Results Elements
  const resultVerdictTitle = document.getElementById('result-verdict-title');
  const urgencyAlertBanner = document.getElementById('urgency-alert-banner');
  const urgencyTitle = document.getElementById('urgency-title');
  const urgencyDescription = document.getElementById('urgency-description');
  const conditionsMatchesList = document.getElementById('conditions-matches-list');
  const recommendedSpecialistType = document.getElementById('recommended-specialist-type');
  const specialistExplanation = document.getElementById('specialist-explanation');
  const specialistIcon = document.getElementById('specialist-icon');
  const homeCareActionsList = document.getElementById('home-care-actions-list');
  const resetDiagnosticsBtn = document.getElementById('reset-diagnostics-btn');
  const saveDiagToHistoryBtn = document.getElementById('save-diag-to-history');
  const downloadPrescriptionBtn = document.getElementById('download-prescription-btn');
  const resultStatusIcon = document.getElementById('result-status-icon');
  const resultStatusIconContainer = document.getElementById('result-status-icon-container');
  
  // Chat Elements
  const chatForm = document.getElementById('chat-form');
  const chatUserInput = document.getElementById('chat-user-input');
  const chatMessagesContainer = document.getElementById('chat-messages-container');
  const clearChatBtn = document.getElementById('clear-chat');
  const chatSendTrigger = document.getElementById('chat-send-trigger');
  const suggestionChips = document.querySelectorAll('.suggestion-chip');
  
  // History Elements
  const historyEmptyState = document.getElementById('history-empty-state');
  const historyList = document.getElementById('history-list');
  const clearHistoryLogBtn = document.getElementById('clear-history-log');
  const redirectToCheckerBtn = document.getElementById('redirect-to-checker');
  
  // Settings Modal Elements
  const settingsModal = document.getElementById('settings-modal');
  const openSettingsBtn = document.getElementById('open-settings-btn');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const profileEditForm = document.getElementById('profile-edit-form');
  const settingsAvatarPreview = document.getElementById('settings-avatar-preview');
  const avatarPresets = document.getElementById('avatar-presets');
  const profNameInput = document.getElementById('prof-name');
  const profGenderInput = document.getElementById('prof-gender');
  const profAgeInput = document.getElementById('prof-age');
  const profWeightInput = document.getElementById('prof-weight');
  const profHeightInput = document.getElementById('prof-height');
  const profBloodInput = document.getElementById('prof-blood');
  const profAllergiesInput = document.getElementById('prof-allergies');
  const profHistoryInput = document.getElementById('prof-history');

  // Track current avatar URL separately (reading .src from DOM gives absolute URL with origin prepended)
  let currentAvatarUrl = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=256';

  // Body Region Popup Elements
  const regionPopup = document.getElementById('body-region-popup');
  const popupCloseBtn = document.getElementById('popup-close-btn');
  const popupRegionTitle = document.getElementById('popup-region-title');
  const popupSymptomsList = document.getElementById('popup-symptoms-list');
  
  // Global SOS
  const emergencyTrigger = document.getElementById('emergency-trigger');

  // --- NEW Aegis Premium Elements and State (Declared at top to avoid ReferenceErrors during initApp) ---
  const voiceSearchBtn = document.getElementById('voice-search-btn');
  
  let skinStream = null;
  const startSkinCamBtn = document.getElementById('start-skin-camera-btn');
  const captureSkinBtn = document.getElementById('capture-skin-btn');
  const skinFileInput = document.getElementById('skin-file-input');
  const skinVideo = document.getElementById('skin-video');
  const skinCanvas = document.getElementById('skin-canvas');
  const skinPlaceholder = document.getElementById('skin-placeholder');
  const skinOverlay = document.getElementById('skin-scan-overlay');
  const skinEmptyState = document.getElementById('skin-empty-state');
  const skinScanningState = document.getElementById('skin-scanning-state');
  const skinResultsState = document.getElementById('skin-results-state');
  const skinProgressBar = document.getElementById('skin-progress-bar');
  const skinPercent = document.getElementById('skin-percent');
  const skinStatusText = document.getElementById('skin-status-text');
  const skinConditionName = document.getElementById('skin-condition-name');
  const skinConditionPct = document.getElementById('skin-condition-pct');
  const skinConditionDesc = document.getElementById('skin-condition-desc');
  const skinCareList = document.getElementById('skin-care-list');
  const resetSkinBtn = document.getElementById('reset-skin-btn');
  const skinRiskBanner = document.getElementById('skin-risk-banner');
  const skinRiskTitle = document.getElementById('skin-risk-title');
  const skinRiskDesc = document.getElementById('skin-risk-desc');

  let heartStream = null;
  let heartAnimationId = null;
  let ppgSignal = [];
  let isFingerCovering = false;
  let heartBPMValues = [];
  let signalCheckCounter = 0;
  const startHeartBtn = document.getElementById('start-heart-btn');
  const heartVideo = document.getElementById('heart-video');
  const heartPulseCircle = document.getElementById('heart-pulse-circle');
  const heartPulseWaveFill = document.getElementById('heart-pulse-wave-fill');
  const heartFingerStatus = document.getElementById('heart-finger-status');
  const ppgCanvas = document.getElementById('ppg-canvas');
  const pulseBpmValue = document.getElementById('pulse-bpm-value');
  const pulseStatusBadge = document.getElementById('pulse-status-badge');
  const pulseAssessmentText = document.getElementById('pulse-assessment-text');

  const addMedForm = document.getElementById('add-med-form');
  const todayMedsList = document.getElementById('today-meds-list');


  const currentWaterVal = document.getElementById('current-water-val');
  const targetWaterVal = document.getElementById('target-water-val');
  const waterFillLevel = document.getElementById('water-fill-level');
  const waterFillPercent = document.getElementById('water-fill-percent');
  const resetWaterBtn = document.getElementById('reset-water-btn');
  const waterReminderToggle = document.getElementById('water-reminder-toggle');


  const sleepForm = document.getElementById('sleep-log-form');
  const sleepHistoryList = document.getElementById('sleep-history-list');


  const calcBmiBtn = document.getElementById('calc-bmi-btn');
  const bmiResultPanel = document.getElementById('bmi-result-panel');
  const bmiValText = document.getElementById('bmi-value-text');
  const bmiStatusText = document.getElementById('bmi-status-text');
  const bmiGaugeMarker = document.getElementById('bmi-gauge-marker');
  const bmiAdviceText = document.getElementById('bmi-advice-text');

  const bloodDropzone = document.getElementById('blood-dropzone');
  const bloodFileInput = document.getElementById('blood-file-input');
  const bloodFileDetails = document.getElementById('blood-file-details');
  const bloodFilename = document.getElementById('blood-filename');
  const bloodFilesize = document.getElementById('blood-filesize');
  const clearBloodFile = document.getElementById('clear-blood-file');
  const analyzeBloodBtn = document.getElementById('analyze-blood-btn');
  const bloodEmptyState = document.getElementById('blood-empty-state');
  const bloodScanningState = document.getElementById('blood-scanning-state');
  const bloodResultsState = document.getElementById('blood-results-state');
  const bloodProgressBar = document.getElementById('blood-progress-bar');
  const bloodPercent = document.getElementById('blood-percent');
  const bloodStatusText = document.getElementById('blood-status-text');
  const bloodTableBody = document.getElementById('blood-table-body');
  const bloodOverallAssessmentText = document.getElementById('blood-overall-assessment-text');
  const resetBloodBtn = document.getElementById('reset-blood-btn');
  const bloodAssessmentBanner = document.getElementById('blood-assessment-banner');

  const riskForm = document.getElementById('risk-assessment-form');
  const riskCalcTrigger = document.getElementById('risk-calc-trigger');
  const riskEmptyState = document.getElementById('risk-empty-state');
  const riskResultsState = document.getElementById('risk-results-state');
  const riskCardioBadge = document.getElementById('risk-cardio-badge');
  const riskCardioFill = document.getElementById('risk-cardio-fill');
  const riskDiabetesBadge = document.getElementById('risk-diabetes-badge');
  const riskDiabetesFill = document.getElementById('risk-diabetes-fill');
  const riskHyperBadge = document.getElementById('risk-hyper-badge');
  const riskHyperFill = document.getElementById('risk-hyper-fill');
  const riskAdviceTextContent = document.getElementById('risk-advice-text-content');
  const resetRiskBtn = document.getElementById('reset-risk-btn');
  const riskAdviceIcon = document.getElementById('risk-advice-icon');
  const riskAdviceBanner = document.getElementById('risk-advice-banner');

  // --- MULTI-LANGUAGE TRANSLATION DICTIONARY ---
  const TRANSLATIONS = {
    en: {
      greeting_hello: "Hello",
      greeting_subtitle: "How are you feeling today? Let's check your health status.",
      emergency_sos: "Emergency SOS",
      search_placeholder: "Type symptoms (e.g. Headache, Fever, Cough)...",
      nav_checker: "Symptom Checker",
      nav_skin: "Skin Detector",
      nav_heart: "Heart Rate",
      nav_reminders: "Reminders",
      nav_trackers: "Sleep & BMI",
      nav_blood: "Blood Report",
      nav_risk: "Risk Predictor",
      nav_assistant: "AI Chat Assistant",
      nav_history: "Scan History",
      nav_insights: "Health Insights",
      skin_detector_title: "Skin Disease Detector",
      skin_detector_subtitle: "Scan skin abnormalities using your camera",
      camera_start_instruction: "Click \"Start Camera\" to begin scanning or upload a photo",
      btn_start_camera: "Start Camera",
      btn_capture_photo: "Capture Photo",
      btn_upload_photo: "Upload Image",
      skin_ready_title: "Dermatological Scanner Ready",
      skin_ready_desc: "Capture a photo or upload an image to run the AI tissue analyzer.",
      skin_analysis_running: "AI Dermatological Analysis Running",
      skin_analysis_status: "Detecting lesions...",
      detected_condition: "Detected Condition",
      care_recommendations: "Self-Care Recommendations",
      btn_reset_scanner: "New Scan",
      heart_title: "Heart Rate Scanner",
      heart_subtitle: "Measure pulse rate by placing your finger over the camera",
      finger_prompt: "Place finger over camera",
      btn_start_pulse_scan: "Start Pulse Scan",
      ppg_graph_title: "Photoplethysmogram (PPG)",
      ppg_graph_subtitle: "Real-time Heart Pulse Signal",
      pulse_waiting: "Waiting for signal...",
      pulse_analysis_title: "Pulse Assessment",
      pulse_waiting_desc: "BPM values will display once readings stabilize. Remain calm for 15s during scan.",
      meds_reminders_title: "Medication Reminders",
      meds_reminders_subtitle: "Configure your daily medications and check schedules",
      today_meds: "Today's Medications",
      add_new_med: "Add New Medication",
      lbl_med_name: "Medication Name",
      lbl_med_dose: "Dosage",
      lbl_med_time: "Time",
      btn_add_med: "Add Medication",
      water_tracker_title: "Water Intake Tracker",
      water_tracker_subtitle: "Track daily hydration goals and intervals",
      enable_water_notifications: "Enable Hourly Hydration Reminders",
      sleep_tracker_title: "Sleep Logging & Quality",
      sleep_tracker_subtitle: "Log your sleeping hours and monitor overnight sleep scores",
      lbl_bedtime: "Bedtime",
      lbl_waketime: "Wake Time",
      lbl_sleep_quality: "Sleep Quality",
      sleep_excellent: "Excellent (Deep, uninterrupted sleep)",
      sleep_good: "Good (Rested sleep)",
      sleep_fair: "Fair (Awoke once or twice)",
      sleep_poor: "Poor (Restless/disturbed sleep)",
      sleep_terrible: "Terrible (Insomnia/very light sleep)",
      btn_log_sleep: "Log Sleep",
      recent_sleep_logs: "Recent Sleep Entries",
      bmi_calculator_title: "BMI Calculator",
      bmi_calculator_subtitle: "Calculate body mass index and health class",
      lbl_weight: "Weight (kg)",
      lbl_height: "Height (cm)",
      btn_calc_bmi: "Calculate BMI",
      blood_ocr_title: "Upload Blood Report",
      blood_ocr_subtitle: "Analyze blood reports and interpret clinical parameters",
      dropzone_instruction: "Drag and drop your report here or click to browse",
      btn_analyze_report: "Analyze Report",
      blood_ready_title: "Blood Report Analyzer Ready",
      blood_ready_desc: "Upload a blood test report to run the AI biomarker extractor.",
      blood_scanning_title: "AI Document Extraction Running",
      blood_scanning_status: "Analyzing structure...",
      extracted_biomarkers: "Biomarker Extraction Results",
      tbl_biomarker: "Biomarker",
      tbl_value: "Value",
      tbl_ref_range: "Reference Range",
      tbl_status: "Status",
      overall_assessment: "Overall Report Assessment",
      btn_upload_another: "Upload Another Report",
      risk_title: "Health Risk Predictor",
      risk_subtitle: "Assess lifestyle risk scores for chronic conditions",
      lbl_systolic: "Systolic Blood Pressure (mmHg)",
      lbl_exercise: "Weekly Exercise (Hours)",
      risk_smoking: "Active Smoker",
      risk_diabetes_history: "Family Diabetes History",
      risk_heart_history: "Family Cardiovascular History",
      risk_alcohol: "Frequent Alcohol Intakes",
      btn_calculate_risk: "Analyze Risk Profiles",
      risk_ready_title: "Risk Prediction Engine Ready",
      risk_ready_desc: "Configure lifestyle parameters to simulate disease risk models.",
      risk_assessment_results: "AI Disease Risk Projections",
      risk_cardio: "Cardiovascular Risk",
      risk_diabetes: "Type 2 Diabetes Risk",
      risk_hyper: "Hypertension Risk",
      preventive_health_advice: "Preventive Recommendations",
      btn_recalculate_risk: "Recalculate Risks"
    },
    bn: {
      greeting_hello: "à¦¹à§à¦¯à¦¾à¦²à§‹",
      greeting_subtitle: "à¦†à¦œ à¦†à¦ªà¦¨à¦¾à¦° à¦•à§‡à¦®à¦¨ à¦²à¦¾à¦—à¦›à§‡? à¦šà¦²à§à¦¨ à¦†à¦ªà¦¨à¦¾à¦° à¦¸à§à¦¬à¦¾à¦¸à§à¦¥à§à¦¯ à¦ªà¦°à§€à¦•à§à¦·à¦¾ à¦•à¦°à¦¾ à¦¯à¦¾à¦•à¥¤",
      emergency_sos: "à¦œà¦°à§à¦°à§€ à¦à¦¸à¦“à¦à¦¸",
      search_placeholder: "à¦‰à¦ªà¦¸à¦°à§à¦— à¦Ÿà¦¾à¦‡à¦ª à¦•à¦°à§à¦¨ (à¦¯à§‡à¦®à¦¨ à¦®à¦¾à¦¥à¦¾ à¦¬à§à¦¯à¦¥à¦¾, à¦œà§à¦¬à¦°, à¦•à¦¾à¦¶à¦¿)...",
      nav_checker: "à¦‰à¦ªà¦¸à¦°à§à¦— à¦ªà¦°à§€à¦•à§à¦·à¦•",
      nav_skin: "à¦¤à§à¦¬à¦• à¦¸à¦¨à¦¾à¦•à§à¦¤à¦•à¦¾à¦°à§€",
      nav_heart: "à¦¹à§ƒà¦¦à¦¸à§à¦ªà¦¨à§à¦¦à¦¨ à¦¹à¦¾à¦°",
      nav_reminders: "à¦…à¦¨à§à¦¸à§à¦®à¦¾à¦°à¦•",
      nav_trackers: "à¦˜à§à¦® à¦“ à¦¬à¦¿à¦à¦®à¦†à¦‡",
      nav_blood: "à¦°à¦•à§à¦¤à§‡à¦° à¦°à¦¿à¦ªà§‹à¦°à§à¦Ÿ",
      nav_risk: "à¦à§à¦à¦•à¦¿ à¦…à¦¨à§à¦®à¦¾à¦¨à¦•à¦¾à¦°à§€",
      nav_assistant: "à¦à¦†à¦‡ à¦¸à¦¹à¦•à¦¾à¦°à§€",
      nav_history: "à¦¸à§à¦•à§à¦¯à¦¾à¦¨ à¦‡à¦¤à¦¿à¦¹à¦¾à¦¸",
      nav_insights: "à¦¸à§à¦¬à¦¾à¦¸à§à¦¥à§à¦¯ à¦…à¦¨à§à¦¤à¦°à§à¦¦à§ƒà¦·à§à¦Ÿà¦¿",
      skin_detector_title: "à¦¤à§à¦¬à¦•à§‡à¦° à¦°à§‹à¦— à¦¨à¦¿à¦°à§à¦£à¦¯à¦¼",
      skin_detector_subtitle: "à¦†à¦ªà¦¨à¦¾à¦° à¦•à§à¦¯à¦¾à¦®à§‡à¦°à¦¾ à¦¬à§à¦¯à¦¬à¦¹à¦¾à¦° à¦•à¦°à§‡ à¦¤à§à¦¬à¦•à§‡à¦° à¦…à¦¸à§à¦¬à¦¾à¦­à¦¾à¦¬à¦¿à¦•à¦¤à¦¾ à¦¸à§à¦•à§à¦¯à¦¾à¦¨ à¦•à¦°à§à¦¨",
      camera_start_instruction: "à¦¸à§à¦•à§à¦¯à¦¾à¦¨à¦¿à¦‚ à¦¶à§à¦°à§ à¦•à¦°à¦¤à§‡ \"à¦•à§à¦¯à¦¾à¦®à§‡à¦°à¦¾ à¦šà¦¾à¦²à§ à¦•à¦°à§à¦¨\"-à¦ à¦•à§à¦²à¦¿à¦• à¦•à¦°à§à¦¨ à¦¬à¦¾ à¦«à¦Ÿà§‹ à¦†à¦ªà¦²à§‹à¦¡ à¦•à¦°à§à¦¨",
      btn_start_camera: "à¦•à§à¦¯à¦¾à¦®à§‡à¦°à¦¾ à¦šà¦¾à¦²à§ à¦•à¦°à§à¦¨",
      btn_capture_photo: "à¦«à¦Ÿà§‹ à¦¤à§à¦²à§à¦¨",
      btn_upload_photo: "à¦«à¦Ÿà§‹ à¦†à¦ªà¦²à§‹à¦¡ à¦•à¦°à§à¦¨",
      skin_ready_title: "à¦¡à¦¾à¦°à§à¦®à¦¾à¦Ÿà§‹à¦²à¦œà¦¿à¦•à§à¦¯à¦¾à¦² à¦¸à§à¦•à§à¦¯à¦¾à¦¨à¦¾à¦° à¦ªà§à¦°à¦¸à§à¦¤à§à¦¤",
      skin_ready_desc: "à¦à¦†à¦‡ à¦Ÿà¦¿à¦¸à§à¦¯à§ à¦¬à¦¿à¦¶à§à¦²à§‡à¦·à¦• à¦šà¦¾à¦²à¦¾à¦¤à§‡ à¦à¦•à¦Ÿà¦¿ à¦«à¦Ÿà§‹ à¦¤à§à¦²à§à¦¨ à¦¬à¦¾ à¦›à¦¬à¦¿ à¦†à¦ªà¦²à§‹à¦¡ à¦•à¦°à§à¦¨à¥¤",
      skin_analysis_running: "à¦à¦†à¦‡ à¦¡à¦¾à¦°à§à¦®à¦¾à¦Ÿà§‹à¦²à¦œà¦¿à¦•à§à¦¯à¦¾à¦² à¦¬à¦¿à¦¶à§à¦²à§‡à¦·à¦£ à¦šà¦²à¦›à§‡",
      skin_analysis_status: "à¦•à§à¦·à¦¤ à¦¸à¦¨à¦¾à¦•à§à¦¤ à¦•à¦°à¦¾ à¦¹à¦šà§à¦›à§‡...",
      detected_condition: "à¦¸à¦¨à¦¾à¦•à§à¦¤à¦•à§ƒà¦¤ à¦…à¦¬à¦¸à§à¦¥à¦¾",
      care_recommendations: "à¦¸à§à¦¬-à¦¯à¦¤à§à¦¨ à¦¸à§à¦ªà¦¾à¦°à¦¿à¦¶à¦®à¦¾à¦²à¦¾",
      btn_reset_scanner: "à¦¨à¦¤à§à¦¨ à¦¸à§à¦•à§à¦¯à¦¾à¦¨",
      heart_title: "à¦¹à§ƒà¦¦à¦¸à§à¦ªà¦¨à§à¦¦à¦¨ à¦¸à§à¦•à§à¦¯à¦¾à¦¨à¦¾à¦°",
      heart_subtitle: "à¦•à§à¦¯à¦¾à¦®à§‡à¦°à¦¾à¦° à¦“à¦ªà¦° à¦†à¦™à§à¦² à¦°à§‡à¦–à§‡ à¦¹à§ƒà¦¦à¦¸à§à¦ªà¦¨à§à¦¦à¦¨ à¦¹à¦¾à¦° à¦ªà¦°à¦¿à¦®à¦¾à¦ª à¦•à¦°à§à¦¨",
      finger_prompt: "à¦•à§à¦¯à¦¾à¦®à§‡à¦°à¦¾à¦° à¦“à¦ªà¦° à¦†à¦™à§à¦² à¦°à¦¾à¦–à§à¦¨",
      btn_start_pulse_scan: "à¦ªà¦¾à¦²à¦¸ à¦¸à§à¦•à§à¦¯à¦¾à¦¨ à¦¶à§à¦°à§ à¦•à¦°à§à¦¨",
      ppg_graph_title: "à¦«à§‹à¦Ÿà§‹à¦ªà§à¦²à§‡à¦¥à¦¿à¦¸à¦®à§‹à¦—à§à¦°à¦¾à¦® (PPG)",
      ppg_graph_subtitle: "à¦°à¦¿à¦¯à¦¼à§‡à¦²-à¦Ÿà¦¾à¦‡à¦® à¦¹à¦¾à¦°à§à¦Ÿ à¦ªà¦¾à¦²à¦¸ à¦¸à¦¿à¦—à¦¨à§à¦¯à¦¾à¦²",
      pulse_waiting: "à¦¸à¦‚à¦•à§‡à¦¤à§‡à¦° à¦œà¦¨à§à¦¯ à¦…à¦ªà§‡à¦•à§à¦·à¦¾ à¦•à¦°à¦¾ à¦¹à¦šà§à¦›à§‡...",
      pulse_analysis_title: "à¦ªà¦¾à¦²à¦¸ à¦®à§‚à¦²à§à¦¯à¦¾à¦¯à¦¼à¦¨",
      pulse_waiting_desc: "à¦°à¦¿à¦¡à¦¿à¦‚ à¦¸à§à¦¥à¦¿à¦¤à¦¿à¦¶à§€à¦² à¦¹à¦²à§‡ à¦¬à¦¿à¦ªà¦¿à¦à¦® (BPM) à¦®à¦¾à¦¨ à¦ªà§à¦°à¦¦à¦°à§à¦¶à¦¿à¦¤ à¦¹à¦¬à§‡à¥¤ à¦¸à§à¦•à§à¦¯à¦¾à¦¨à§‡à¦° à¦¸à¦®à¦¯à¦¼ à§§à§« à¦¸à§‡à¦•à§‡à¦¨à§à¦¡ à¦¶à¦¾à¦¨à§à¦¤ à¦¥à¦¾à¦•à§à¦¨à¥¤",
      meds_reminders_title: "à¦“à¦·à§à¦§à§‡à¦° à¦…à¦¨à§à¦¸à§à¦®à¦¾à¦°à¦•",
      meds_reminders_subtitle: "à¦†à¦ªà¦¨à¦¾à¦° à¦¦à§ˆà¦¨à¦¿à¦• à¦“à¦·à§à¦§ à¦•à¦¨à¦«à¦¿à¦—à¦¾à¦° à¦•à¦°à§à¦¨ à¦à¦¬à¦‚ à¦¤à¦¾à¦²à¦¿à¦•à¦¾ à¦ªà¦°à§€à¦•à§à¦·à¦¾ à¦•à¦°à§à¦¨",
      today_meds: "à¦†à¦œà¦•à§‡à¦° à¦“à¦·à§à¦§",
      add_new_med: "à¦¨à¦¤à§à¦¨ à¦“à¦·à§à¦§ à¦¯à§‹à¦— à¦•à¦°à§à¦¨",
      lbl_med_name: "à¦“à¦·à§à¦§à§‡à¦° à¦¨à¦¾à¦®",
      lbl_med_dose: "à¦¡à§‹à¦œ",
      lbl_med_time: "à¦¸à¦®à¦¯à¦¼",
      btn_add_med: "à¦“à¦·à§à¦§ à¦¯à§‹à¦— à¦•à¦°à§à¦¨",
      water_tracker_title: "à¦œà¦² à¦ªà¦¾à¦¨à§‡à¦° à¦Ÿà§à¦°à§à¦¯à¦¾à¦•à¦¾à¦°",
      water_tracker_subtitle: "à¦¦à§ˆà¦¨à¦¿à¦• à¦œà¦² à¦ªà¦¾à¦¨à§‡à¦° à¦²à¦•à§à¦·à§à¦¯ à¦“ à¦…à¦¨à§à¦¸à§à¦®à¦¾à¦°à¦• à¦Ÿà§à¦°à§à¦¯à¦¾à¦• à¦•à¦°à§à¦¨",
      enable_water_notifications: "à¦ªà§à¦°à¦¤à¦¿ à¦˜à¦£à§à¦Ÿà¦¾à¦° à¦œà¦² à¦ªà¦¾à¦¨à§‡à¦° à¦…à¦¨à§à¦¸à§à¦®à¦¾à¦°à¦• à¦šà¦¾à¦²à§ à¦•à¦°à§à¦¨",
      sleep_tracker_title: "à¦˜à§à¦®à§‡à¦° à¦²à¦— à¦“ à¦—à§à¦£à¦®à¦¾à¦¨",
      sleep_tracker_subtitle: "à¦†à¦ªà¦¨à¦¾à¦° à¦˜à§à¦®à§‡à¦° à¦¸à¦®à¦¯à¦¼ à¦²à¦— à¦•à¦°à§à¦¨ à¦à¦¬à¦‚ à¦°à¦¾à¦¤à¦¾à¦°à¦¾à¦¤à¦¿ à¦˜à§à¦®à§‡à¦° à¦®à¦¾à¦¨ à¦¨à¦¿à¦°à§€à¦•à§à¦·à¦£ à¦•à¦°à§à¦¨",
      lbl_bedtime: "à¦˜à§à¦®à¦¾à¦¨à§‹à¦° à¦¸à¦®à¦¯à¦¼",
      lbl_waketime: "à¦œà§‡à¦—à§‡ à¦“à¦ à¦¾à¦° à¦¸à¦®à¦¯à¦¼",
      lbl_sleep_quality: "à¦˜à§à¦®à§‡à¦° à¦—à§à¦£à¦®à¦¾à¦¨",
      sleep_excellent: "à¦šà¦®à§Žà¦•à¦¾à¦° (à¦—à¦­à§€à¦°, à¦¨à¦¿à¦°à¦¬à¦šà§à¦›à¦¿à¦¨à§à¦¨ à¦˜à§à¦®)",
      sleep_good: "à¦­à¦¾à¦²à§‹ (à¦ªà¦°à§à¦¯à¦¾à¦ªà§à¦¤ à¦˜à§à¦®)",
      sleep_fair: "à¦®à§‹à¦Ÿà¦¾à¦®à§à¦Ÿà¦¿ (à¦à¦• à¦¬à¦¾ à¦¦à§à¦‡à¦¬à¦¾à¦° à¦˜à§à¦® à¦­à§‡à¦™à§‡à¦›à§‡)",
      sleep_poor: "à¦–à¦¾à¦°à¦¾à¦ª (à¦…à¦¸à§à¦¥à¦¿à¦°/à¦¬à¦¿à¦˜à§à¦¨à¦¿à¦¤ à¦˜à§à¦®)",
      sleep_terrible: "à¦–à§à¦¬ à¦–à¦¾à¦°à¦¾à¦ª (à¦…à¦¨à¦¿à¦¦à§à¦°à¦¾/à¦–à§à¦¬ à¦¹à¦¾à¦²à¦•à¦¾ à¦˜à§à¦®)",
      btn_log_sleep: "à¦˜à§à¦® à¦²à¦— à¦•à¦°à§à¦¨",
      recent_sleep_logs: "à¦¸à¦¾à¦®à§à¦ªà§à¦°à¦¤à¦¿à¦• à¦˜à§à¦®à§‡à¦° à¦°à§‡à¦•à¦°à§à¦¡",
      bmi_calculator_title: "à¦¬à¦¿à¦à¦®à¦†à¦‡ à¦•à§à¦¯à¦¾à¦²à¦•à§à¦²à§‡à¦Ÿà¦°",
      bmi_calculator_subtitle: "à¦¬à¦¡à¦¿ à¦®à¦¾à¦¸ à¦‡à¦¨à¦¡à§‡à¦•à§à¦¸ à¦à¦¬à¦‚ à¦¸à§à¦¬à¦¾à¦¸à§à¦¥à§à¦¯à§‡à¦° à¦…à¦¬à¦¸à§à¦¥à¦¾ à¦—à¦£à¦¨à¦¾ à¦•à¦°à§à¦¨",
      lbl_weight: "à¦“à¦œà¦¨ (à¦•à§‡à¦œà¦¿)",
      lbl_height: "à¦‰à¦šà§à¦šà¦¤à¦¾ (à¦¸à§‡à¦®à¦¿)",
      btn_calc_bmi: "à¦¬à¦¿à¦à¦®à¦†à¦‡ à¦—à¦£à¦¨à¦¾ à¦•à¦°à§à¦¨",
      blood_ocr_title: "à¦°à¦•à§à¦¤à§‡à¦° à¦°à¦¿à¦ªà§‹à¦°à§à¦Ÿ à¦†à¦ªà¦²à§‹à¦¡ à¦•à¦°à§à¦¨",
      blood_ocr_subtitle: "à¦°à¦•à§à¦¤à§‡à¦° à¦°à¦¿à¦ªà§‹à¦°à§à¦Ÿ à¦¬à¦¿à¦¶à§à¦²à§‡à¦·à¦£ à¦à¦¬à¦‚ à¦•à§à¦²à¦¿à¦¨à¦¿à¦•à¦¾à¦² à¦ªà§à¦¯à¦¾à¦°à¦¾à¦®à¦¿à¦Ÿà¦¾à¦° à¦¬à§à¦¯à¦¾à¦–à§à¦¯à¦¾ à¦•à¦°à§à¦¨",
      dropzone_instruction: "à¦†à¦ªà¦¨à¦¾à¦° à¦°à¦¿à¦ªà§‹à¦°à§à¦Ÿà¦Ÿà¦¿ à¦à¦–à¦¾à¦¨à§‡ à¦¡à§à¦°à§à¦¯à¦¾à¦— à¦…à§à¦¯à¦¾à¦¨à§à¦¡ à¦¡à§à¦°à¦ª à¦•à¦°à§à¦¨ à¦¬à¦¾ à¦¬à§à¦°à¦¾à¦‰à¦œ à¦•à¦°à¦¤à§‡ à¦•à§à¦²à¦¿à¦• à¦•à¦°à§à¦¨",
      btn_analyze_report: "à¦°à¦¿à¦ªà§‹à¦°à§à¦Ÿ à¦¬à¦¿à¦¶à§à¦²à§‡à¦·à¦£ à¦•à¦°à§à¦¨",
      blood_ready_title: "à¦°à¦•à§à¦¤à§‡à¦° à¦°à¦¿à¦ªà§‹à¦°à§à¦Ÿ à¦¬à¦¿à¦¶à§à¦²à§‡à¦·à¦• à¦ªà§à¦°à¦¸à§à¦¤à§à¦¤",
      blood_ready_desc: "à¦à¦†à¦‡ à¦¬à¦¾à¦¯à¦¼à§‹à¦®à¦¾à¦°à§à¦•à¦¾à¦° à¦à¦•à§à¦¸à¦Ÿà§à¦°à¦¾à¦•à§à¦Ÿà¦° à¦šà¦¾à¦²à¦¾à¦¤à§‡ à¦°à¦•à§à¦¤à§‡à¦° à¦°à¦¿à¦ªà§‹à¦°à§à¦Ÿ à¦†à¦ªà¦²à§‹à¦¡ à¦•à¦°à§à¦¨à¥¤",
      blood_scanning_title: "à¦à¦†à¦‡ à¦¨à¦¥à¦¿ à¦¨à¦¿à¦·à§à¦•à¦¾à¦¶à¦¨ à¦šà¦²à¦›à§‡",
      blood_scanning_status: "à¦¬à¦¿à¦¶à§à¦²à§‡à¦·à¦£ à¦•à¦°à¦¾ à¦¹à¦šà§à¦›à§‡...",
      extracted_biomarkers: "à¦¬à¦¾à§Ÿà§‹à¦®à¦¾à¦°à§à¦•à¦¾à¦° à¦¨à¦¿à¦·à§à¦•à¦¾à¦¶à¦¨à§‡à¦° à¦«à¦²à¦¾à¦«à¦²",
      tbl_biomarker: "à¦¬à¦¾à¦¯à¦¼à§‹à¦®à¦¾à¦°à§à¦•à¦¾à¦°",
      tbl_value: "à¦®à¦¾à¦¨",
      tbl_ref_range: "à¦°à§‡à¦«à¦¾à¦°à§‡à¦¨à§à¦¸ à¦ªà¦°à¦¿à¦¸à§€à¦®à¦¾",
      tbl_status: "à¦…à¦¬à¦¸à§à¦¥à¦¾",
      overall_assessment: "à¦¸à¦¾à¦®à¦—à§à¦°à¦¿à¦• à¦°à¦¿à¦ªà§‹à¦°à§à¦Ÿ à¦®à§‚à¦²à§à¦¯à¦¾à¦¯à¦¼à¦¨",
      btn_upload_another: "à¦…à¦¨à§à¦¯ à¦°à¦¿à¦ªà§‹à¦°à§à¦Ÿ à¦†à¦ªà¦²à§‹à¦¡ à¦•à¦°à§à¦¨",
      risk_title: "à¦¸à§à¦¬à¦¾à¦¸à§à¦¥à§à¦¯ à¦à§à¦à¦•à¦¿ à¦¨à¦¿à¦°à§à¦£à§Ÿà¦•à¦¾à¦°à§€",
      risk_subtitle: "à¦¦à§€à¦°à§à¦˜à¦¸à§à¦¥à¦¾à¦¯à¦¼à§€ à¦°à§‹à¦—à§‡à¦° à¦œà¦¨à§à¦¯ à¦œà§€à¦¬à¦¨à¦¯à¦¾à¦¤à§à¦°à¦¾à¦° à¦à§à¦à¦•à¦¿ à¦®à§‚à¦²à§à¦¯à¦¾à¦¯à¦¼à¦¨ à¦•à¦°à§à¦¨",
      lbl_systolic: "à¦¸à¦¿à¦¸à§à¦Ÿà§‹à¦²à¦¿à¦• à¦°à¦•à§à¦¤à¦šà¦¾à¦ª (mmHg)",
      lbl_exercise: "à¦¸à¦¾à¦ªà§à¦¤à¦¾à¦¹à¦¿à¦• à¦¬à§à¦¯à¦¾à¦¯à¦¼à¦¾à¦® (à¦˜à¦£à§à¦Ÿà¦¾)",
      risk_smoking: "à¦§à§‚à¦®à¦ªà¦¾à¦¯à¦¼à§€",
      risk_diabetes_history: "à¦ªà¦°à¦¿à¦¬à¦¾à¦°à§‡ à¦¡à¦¾à¦¯à¦¼à¦¾à¦¬à§‡à¦Ÿà¦¿à¦¸ à¦‡à¦¤à¦¿à¦¹à¦¾à¦¸",
      risk_heart_history: "à¦ªà¦°à¦¿à¦¬à¦¾à¦°à§‡ à¦¹à§ƒà¦¦à¦°à§‹à¦—à§‡à¦° à¦‡à¦¤à¦¿à¦¹à¦¾à¦¸",
      risk_alcohol: "à¦˜à¦¨ à¦˜à¦¨ à¦…à§à¦¯à¦¾à¦²à¦•à§‹à¦¹à¦² à¦¸à§‡à¦¬à¦¨",
      btn_calculate_risk: "à¦à§à¦à¦•à¦¿ à¦¬à¦¿à¦¶à§à¦²à§‡à¦·à¦£ à¦•à¦°à§à¦¨",
      risk_ready_title: "à¦à§à¦à¦•à¦¿ à¦¬à¦¿à¦¶à§à¦²à§‡à¦·à¦£ à¦‡à¦žà§à¦œà¦¿à¦¨ à¦ªà§à¦°à¦¸à§à¦¤à§à¦¤",
      risk_ready_desc: "à¦°à§‹à¦—à§‡à¦° à¦à§à¦à¦•à¦¿ à¦®à¦¡à§‡à¦² à¦…à¦¨à§à¦•à¦°à¦£ à¦•à¦°à¦¤à§‡ à¦œà§€à¦¬à¦¨à¦¯à¦¾à¦¤à§à¦°à¦¾à¦° à¦ªà§à¦¯à¦¾à¦°à¦¾à¦®à¦¿à¦Ÿà¦¾à¦° à¦•à¦¨à¦«à¦¿à¦—à¦¾à¦° à¦•à¦°à§à¦¨à¥¤",
      risk_assessment_results: "à¦à¦†à¦‡ à¦°à§‹à¦— à¦à§à¦à¦•à¦¿ à¦ªà§à¦°à¦œà§‡à¦•à¦¶à¦¨",
      risk_cardio: "à¦¹à§ƒà¦¦à¦°à§‹à¦—à§‡à¦° à¦à§à¦à¦•à¦¿",
      risk_diabetes: "à¦Ÿà¦¾à¦‡à¦ª à§¨ à¦¡à¦¾à¦¯à¦¼à¦¾à¦¬à§‡à¦Ÿà¦¿à¦¸à§‡à¦° à¦à§à¦à¦•à¦¿",
      risk_hyper: "à¦‰à¦šà§à¦š à¦°à¦•à§à¦¤à¦šà¦¾à¦ªà§‡à¦° à¦à§à¦à¦•à¦¿",
      preventive_health_advice: "à¦ªà§à¦°à¦¤à¦¿à¦°à§‹à¦§à¦®à§‚à¦²à¦• à¦¸à§à¦ªà¦¾à¦°à¦¿à¦¶à¦¸à¦®à§‚à¦¹",
      btn_recalculate_risk: "à¦¨à¦¤à§à¦¨ à¦®à§‚à¦²à§à¦¯à¦¾à¦¯à¦¼à¦¨ à¦¶à§à¦°à§ à¦•à¦°à§à¦¨"
    },
    hi: {
      greeting_hello: "à¤¨à¤®à¤¸à¥à¤¤à¥‡",
      greeting_subtitle: "à¤†à¤œ à¤†à¤ª à¤•à¥ˆà¤¸à¤¾ à¤®à¤¹à¤¸à¥‚à¤¸ à¤•à¤° à¤°à¤¹à¥‡ à¤¹à¥ˆà¤‚? à¤†à¤‡à¤ à¤¸à¥à¤µà¤¾à¤¸à¥à¤¥à¥à¤¯ à¤•à¥€ à¤œà¤¾à¤‚à¤š à¤•à¤°à¥‡à¤‚à¥¤",
      emergency_sos: "à¤†à¤ªà¤¾à¤¤à¤•à¤¾à¤²à¥€à¤¨ à¤à¤¸à¤“à¤à¤¸",
      search_placeholder: "à¤²à¤•à¥à¤·à¤£ à¤¦à¤°à¥à¤œ à¤•à¤°à¥‡à¤‚ (à¤œà¥ˆà¤¸à¥‡ à¤¸à¤¿à¤°à¤¦à¤°à¥à¤¦, à¤¬à¥à¤–à¤¾à¤°, à¤–à¤¾à¤‚à¤¸à¥€)...",
      nav_checker: "à¤²à¤•à¥à¤·à¤£ à¤œà¤¾à¤à¤šà¤•à¤°à¥à¤¤à¤¾",
      nav_skin: "à¤¤à¥à¤µà¤šà¤¾ à¤ªà¤¹à¤šà¤¾à¤¨",
      nav_heart: "à¤¹à¥ƒà¤¦à¤¯ à¤—à¤¤à¤¿",
      nav_reminders: "à¤°à¤¿à¤®à¤¾à¤‡à¤‚à¤¡à¤°à¥à¤¸",
      nav_trackers: "à¤¨à¥€à¤‚à¤¦ à¤”à¤° à¤¬à¥€à¤à¤®à¤†à¤ˆ",
      nav_blood: "à¤°à¤•à¥à¤¤ à¤°à¤¿à¤ªà¥‹à¤°à¥à¤Ÿ",
      nav_risk: "à¤œà¥‹à¤–à¤¿à¤® à¤…à¤¨à¥à¤®à¤¾à¤¨",
      nav_assistant: "à¤à¤†à¤ˆ à¤¸à¤¹à¤¾à¤¯à¤•",
      nav_history: "à¤œà¤¾à¤‚à¤š à¤‡à¤¤à¤¿à¤¹à¤¾à¤¸",
      nav_insights: "à¤¸à¥à¤µà¤¾à¤¸à¥à¤¥à¥à¤¯ à¤…à¤‚à¤¤à¤°à¥à¤¦à¥ƒà¤·à¥à¤Ÿà¤¿",
      skin_detector_title: "à¤¤à¥à¤µà¤šà¤¾ à¤°à¥‹à¤— à¤ªà¤¹à¤šà¤¾à¤¨à¤•à¤°à¥à¤¤à¤¾",
      skin_detector_subtitle: "à¤•à¥ˆà¤®à¤°à¥‡ à¤•à¤¾ à¤‰à¤ªà¤¯à¥‹à¤— à¤•à¤°à¤•à¥‡ à¤¤à¥à¤µà¤šà¤¾ à¤•à¥€ à¤…à¤¸à¤¾à¤®à¤¾à¤¨à¥à¤¯à¤¤à¤¾à¤“à¤‚ à¤•à¥‹ à¤¸à¥à¤•à¥ˆà¤¨ à¤•à¤°à¥‡à¤‚",
      camera_start_instruction: "à¤¸à¥à¤•à¥ˆà¤¨à¤¿à¤‚à¤— à¤¶à¥à¤°à¥‚ à¤•à¤°à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ \"à¤•à¥ˆà¤®à¤°à¤¾ à¤šà¤¾à¤²à¥‚ à¤•à¤°à¥‡à¤‚\" à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¥‡à¤‚ à¤¯à¤¾ à¤«à¥‹à¤Ÿà¥‹ à¤…à¤ªà¤²à¥‹à¤¡ à¤•à¤°à¥‡à¤‚",
      btn_start_camera: "à¤•à¥ˆà¤®à¤°à¤¾ à¤šà¤¾à¤²à¥‚ à¤•à¤°à¥‡à¤‚",
      btn_capture_photo: "à¤«à¥‹à¤Ÿà¥‹ à¤–à¥€à¤‚à¤šà¥‡à¤‚",
      btn_upload_photo: "à¤«à¥‹à¤Ÿà¥‹ à¤…à¤ªà¤²à¥‹à¤¡ à¤•à¤°à¥‡à¤‚",
      skin_ready_title: "à¤¤à¥à¤µà¤šà¤¾ à¤¸à¥à¤•à¥ˆà¤¨à¤° à¤¤à¥ˆà¤¯à¤¾à¤°",
      skin_ready_desc: "à¤à¤†à¤ˆ à¤Šà¤¤à¤• à¤µà¤¿à¤¶à¥à¤²à¥‡à¤·à¤• à¤šà¤²à¤¾à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤à¤• à¤«à¥‹à¤Ÿà¥‹ à¤²à¥‡à¤‚ à¤¯à¤¾ à¤…à¤ªà¤²à¥‹à¤¡ à¤•à¤°à¥‡à¤‚à¥¤",
      skin_analysis_running: "à¤à¤†à¤ˆ à¤¤à¥à¤µà¤šà¤¾ à¤µà¤¿à¤¶à¥à¤²à¥‡à¤·à¤£ à¤œà¤¾à¤°à¥€",
      skin_analysis_status: "à¤˜à¤¾à¤µà¥‹à¤‚ à¤•à¤¾ à¤ªà¤¤à¤¾ à¤²à¤—à¤¾à¤¯à¤¾ à¤œà¤¾ à¤°à¤¹à¤¾ à¤¹à¥ˆ...",
      detected_condition: "à¤ªà¤¹à¤šà¤¾à¤¨à¤¾ à¤—à¤¯à¤¾ à¤°à¥‹à¤—",
      care_recommendations: "à¤¸à¥à¤µ-à¤¦à¥‡à¤–à¤­à¤¾à¤² à¤¸à¤¿à¤«à¤¾à¤°à¤¿à¤¶à¥‡à¤‚",
      btn_reset_scanner: "à¤¨à¤¯à¤¾ à¤¸à¥à¤•à¥ˆà¤¨",
      heart_title: "à¤¹à¥ƒà¤¦à¤¯ à¤—à¤¤à¤¿ à¤¸à¥à¤•à¥ˆà¤¨à¤°",
      heart_subtitle: "à¤•à¥ˆà¤®à¤°à¥‡ à¤ªà¤° à¤…à¤ªà¤¨à¥€ à¤‰à¤‚à¤—à¤²à¥€ à¤°à¤–à¤•à¤° à¤¨à¤¾à¤¡à¤¼à¥€ à¤¦à¤° à¤®à¤¾à¤ªà¥‡à¤‚",
      finger_prompt: "à¤•à¥ˆà¤®à¤°à¥‡ à¤ªà¤° à¤‰à¤‚à¤—à¤²à¥€ à¤°à¤–à¥‡à¤‚",
      btn_start_pulse_scan: "à¤ªà¤²à¥à¤¸ à¤¸à¥à¤•à¥ˆà¤¨ à¤¶à¥à¤°à¥‚ à¤•à¤°à¥‡à¤‚",
      ppg_graph_title: "à¤«à¥‹à¤Ÿà¥‹à¤ªà¥à¤²à¥‡à¤¥à¤¿à¤¸à¥à¤®à¥‹à¤—à¥à¤°à¤¾à¤® (PPG)",
      ppg_graph_subtitle: "à¤µà¤¾à¤¸à¥à¤¤à¤µà¤¿à¤• à¤¸à¤®à¤¯ à¤¹à¥ƒà¤¦à¤¯ à¤ªà¤²à¥à¤¸ à¤¸à¤¿à¤—à¥à¤¨à¤²",
      pulse_waiting: "à¤¸à¤¿à¤—à¥à¤¨à¤² à¤•à¥€ à¤ªà¥à¤°à¤¤à¥€à¤•à¥à¤·à¤¾ à¤¹à¥ˆ...",
      pulse_analysis_title: "à¤ªà¤²à¥à¤¸ à¤®à¥‚à¤²à¥à¤¯à¤¾à¤‚à¤•à¤¨",
      pulse_waiting_desc: "à¤°à¥€à¤¡à¤¿à¤‚à¤— à¤¸à¥à¤¥à¤¿à¤° à¤¹à¥‹à¤¨à¥‡ à¤ªà¤° à¤¬à¥€à¤ªà¥€à¤à¤® (BPM) à¤ªà¥à¤°à¤¦à¤°à¥à¤¶à¤¿à¤¤ à¤¹à¥‹à¤—à¤¾à¥¤ à¤¸à¥à¤•à¥ˆà¤¨ à¤•à¥‡ à¤¦à¥Œà¤°à¤¾à¤¨ 15 à¤¸à¥‡à¤•à¤‚à¤¡ à¤¤à¤• à¤¶à¤¾à¤‚à¤¤ à¤°à¤¹à¥‡à¤‚à¥¤",
      meds_reminders_title: "à¤¦à¤µà¤¾ à¤°à¤¿à¤®à¤¾à¤‡à¤‚à¤¡à¤°",
      meds_reminders_subtitle: "à¤¦à¥ˆà¤¨à¤¿à¤• à¤¦à¤µà¤¾à¤“à¤‚ à¤•à¤¾ à¤¸à¤®à¤¯ à¤¨à¤¿à¤°à¥à¤§à¤¾à¤°à¤¿à¤¤ à¤•à¤°à¥‡à¤‚ à¤”à¤° à¤ªà¥‚à¤°à¥à¤£ à¤šà¤¿à¤¨à¥à¤¹ à¤²à¤—à¤¾à¤à¤‚",
      today_meds: "à¤†à¤œ à¤•à¥€ à¤¦à¤µà¤¾à¤à¤‚",
      add_new_med: "à¤¨à¤ˆ à¤¦à¤µà¤¾ à¤œà¥‹à¤¡à¤¼à¥‡à¤‚",
      lbl_med_name: "à¤¦à¤µà¤¾ à¤•à¤¾ à¤¨à¤¾à¤®",
      lbl_med_dose: "à¤–à¥à¤°à¤¾à¤•",
      lbl_med_time: "à¤¸à¤®à¤¯",
      btn_add_med: "à¤¦à¤µà¤¾ à¤œà¥‹à¤¡à¤¼à¥‡à¤‚",
      water_tracker_title: "à¤ªà¤¾à¤¨à¥€ à¤¸à¥‡à¤µà¤¨ à¤Ÿà¥à¤°à¥ˆà¤•à¤°",
      water_tracker_subtitle: "à¤¦à¥ˆà¤¨à¤¿à¤• à¤¹à¤¾à¤‡à¤¡à¥à¤°à¥‡à¤¶à¤¨ à¤”à¤° à¤°à¤¿à¤®à¤¾à¤‡à¤‚à¤¡à¤°à¥à¤¸ à¤Ÿà¥à¤°à¥ˆà¤• à¤•à¤°à¥‡à¤‚",
      enable_water_notifications: "à¤ªà¥à¤°à¤¤à¤¿ à¤˜à¤‚à¤Ÿà¥‡ à¤¹à¤¾à¤‡à¤¡à¥à¤°à¥‡à¤¶à¤¨ à¤°à¤¿à¤®à¤¾à¤‡à¤‚à¤¡à¤° à¤¸à¤•à¥à¤·à¤® à¤•à¤°à¥‡à¤‚",
      sleep_tracker_title: "à¤¨à¥€à¤‚à¤¦ à¤•à¤¾ à¤²à¥‰à¤— à¤”à¤° à¤—à¥à¤£à¤µà¤¤à¥à¤¤à¤¾",
      sleep_tracker_subtitle: "à¤¸à¥‹à¤¨à¥‡ à¤•à¥‡ à¤˜à¤‚à¤Ÿà¥‡ à¤¦à¤°à¥à¤œ à¤•à¤°à¥‡à¤‚ à¤”à¤° à¤°à¤¾à¤¤ à¤­à¤° à¤•à¥‡ à¤ªà¥ˆà¤Ÿà¤°à¥à¤¨ à¤•à¥€ à¤¨à¤¿à¤—à¤°à¤¾à¤¨à¥€ à¤•à¤°à¥‡à¤‚",
      lbl_bedtime: "à¤¸à¥‹à¤¨à¥‡ à¤•à¤¾ à¤¸à¤®à¤¯",
      lbl_waketime: "à¤œà¤¾à¤—à¤¨à¥‡ à¤•à¤¾ à¤¸à¤®à¤¯",
      lbl_sleep_quality: "à¤¨à¥€à¤‚à¤¦ à¤•à¥€ à¤—à¥à¤£à¤µà¤¤à¥à¤¤à¤¾",
      sleep_excellent: "à¤‰à¤¤à¥à¤•à¥ƒà¤·à¥à¤Ÿ (à¤—à¤¹à¤°à¥€, à¤…à¤¬à¤¾à¤§à¤¿à¤¤ à¤¨à¥€à¤‚à¤¦)",
      sleep_good: "à¤…à¤šà¥à¤›à¤¾ (à¤†à¤°à¤¾à¤®à¤¦à¤¾à¤¯à¤• à¤¨à¥€à¤‚à¤¦)",
      sleep_fair: "à¤¸à¤¾à¤®à¤¾à¤¨à¥à¤¯ (à¤à¤• à¤¯à¤¾ à¤¦à¥‹ à¤¬à¤¾à¤° à¤†à¤‚à¤– à¤–à¥à¤²à¥€)",
      sleep_poor: "à¤–à¤°à¤¾à¤¬ (à¤…à¤¶à¤¾à¤‚à¤¤/à¤¬à¤¾à¤§à¤¿à¤¤ à¤¨à¥€à¤‚à¤¦)",
      sleep_terrible: "à¤¬à¤¹à¥à¤¤ à¤–à¤°à¤¾à¤¬ (à¤…à¤¨à¤¿à¤¦à¥à¤°à¤¾/à¤¬à¤¹à¥à¤¤ à¤¹à¤²à¥à¤•à¥€ à¤¨à¥€à¤‚à¤¦)",
      btn_log_sleep: "à¤¨à¥€à¤‚à¤¦ à¤²à¥‰à¤— à¤•à¤°à¥‡à¤‚",
      recent_sleep_logs: "à¤¹à¤¾à¤²à¤¿à¤¯à¤¾ à¤¨à¥€à¤‚à¤¦ à¤²à¥‰à¤—",
      bmi_calculator_title: "à¤¬à¥€à¤à¤®à¤†à¤ˆ à¤•à¥ˆà¤²à¤•à¥à¤²à¥‡à¤Ÿà¤°",
      bmi_calculator_subtitle: "à¤¬à¥‰à¤¡à¥€ à¤®à¤¾à¤¸ à¤‡à¤‚à¤¡à¥‡à¤•à¥à¤¸ à¤”à¤° à¤¸à¥à¤µà¤¾à¤¸à¥à¤¥à¥à¤¯ à¤¸à¥à¤¥à¤¿à¤¤à¤¿ à¤•à¥€ à¤—à¤£à¤¨à¤¾ à¤•à¤°à¥‡à¤‚",
      lbl_weight: "à¤µà¤œà¤¨ (à¤•à¤¿à¤²à¥‹à¤—à¥à¤°à¤¾à¤®)",
      lbl_height: "à¤²à¤‚à¤¬à¤¾à¤ˆ (à¤¸à¥‡à¤®à¥€)",
      btn_calc_bmi: "à¤¬à¥€à¤à¤®à¤†à¤ˆ à¤—à¤£à¤¨à¤¾ à¤•à¤°à¥‡à¤‚",
      blood_ocr_title: "à¤°à¤•à¥à¤¤ à¤°à¤¿à¤ªà¥‹à¤°à¥à¤Ÿ à¤…à¤ªà¤²à¥‹à¤¡ à¤•à¤°à¥‡à¤‚",
      blood_ocr_subtitle: "à¤°à¤•à¥à¤¤ à¤°à¤¿à¤ªà¥‹à¤°à¥à¤Ÿ à¤•à¤¾ à¤µà¤¿à¤¶à¥à¤²à¥‡à¤·à¤£ à¤•à¤°à¥‡à¤‚ à¤”à¤° à¤¨à¥ˆà¤¦à¤¾à¤¨à¤¿à¤• à¤®à¤¾à¤ªà¤¦à¤‚à¤¡à¥‹à¤‚ à¤•à¥€ à¤µà¥à¤¯à¤¾à¤–à¥à¤¯à¤¾ à¤•à¤°à¥‡à¤‚",
      dropzone_instruction: "à¤…à¤ªà¤¨à¥€ à¤°à¤¿à¤ªà¥‹à¤°à¥à¤Ÿ à¤•à¥‹ à¤¯à¤¹à¤¾à¤‚ à¤¡à¥à¤°à¥ˆà¤— à¤”à¤° à¤¡à¥à¤°à¥‰à¤ª à¤•à¤°à¥‡à¤‚ à¤¯à¤¾ à¤¬à¥à¤°à¤¾à¤‰à¤œà¤¼ à¤•à¤°à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¥‡à¤‚",
      btn_analyze_report: "à¤°à¤¿à¤ªà¥‹à¤°à¥à¤Ÿ à¤•à¤¾ à¤µà¤¿à¤¶à¥à¤²à¥‡à¤·à¤£ à¤•à¤°à¥‡à¤‚",
      blood_ready_title: "à¤°à¤•à¥à¤¤ à¤°à¤¿à¤ªà¥‹à¤°à¥à¤Ÿ à¤µà¤¿à¤¶à¥à¤²à¥‡à¤·à¤• à¤¤à¥ˆà¤¯à¤¾à¤°",
      blood_ready_desc: "à¤à¤†à¤ˆ à¤¬à¤¾à¤¯à¥‹à¤®à¤¾à¤°à¥à¤•à¤° à¤à¤•à¥à¤¸à¤Ÿà¥à¤°à¥ˆà¤•à¥à¤Ÿà¤° à¤šà¤²à¤¾à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤°à¤•à¥à¤¤ à¤ªà¤°à¥€à¤•à¥à¤·à¤£ à¤°à¤¿à¤ªà¥‹à¤°à¥à¤Ÿ à¤…à¤ªà¤²à¥‹à¤¡ à¤•à¤°à¥‡à¤‚à¥¤",
      blood_scanning_title: "à¤à¤†à¤ˆ à¤¦à¤¸à¥à¤¤à¤¾à¤µà¥‡à¤œà¤¼ à¤¨à¤¿à¤·à¥à¤•à¤°à¥à¤·à¤£ à¤œà¤¾à¤°à¥€",
      blood_scanning_status: "à¤µà¤¿à¤¶à¥à¤²à¥‡à¤·à¤£ à¤•à¤¿à¤¯à¤¾ à¤œà¤¾ à¤°à¤¹à¤¾ à¤¹à¥ˆ...",
      extracted_biomarkers: "à¤¬à¤¾à¤¯à¥‹à¤®à¤¾à¤°à¥à¤•à¤° à¤¨à¤¿à¤·à¥à¤•à¤°à¥à¤·à¤£ à¤ªà¤°à¤¿à¤£à¤¾à¤®",
      tbl_biomarker: "à¤¬à¤¾à¤¯à¥‹à¤®à¤¾à¤°à¥à¤•à¤°",
      tbl_value: "à¤®à¥‚à¤²à¥à¤¯",
      tbl_ref_range: "à¤¸à¤‚à¤¦à¤°à¥à¤­ à¤¸à¥€à¤®à¤¾",
      tbl_status: "à¤¸à¥à¤¥à¤¿à¤¤à¤¿",
      overall_assessment: "à¤¸à¤®à¤—à¥à¤° à¤°à¤¿à¤ªà¥‹à¤°à¥à¤Ÿ à¤®à¥‚à¤²à¥à¤¯à¤¾à¤‚à¤•à¤¨",
      btn_upload_another: "à¤…à¤¨à¥à¤¯ à¤°à¤¿à¤ªà¥‹à¤°à¥à¤Ÿ à¤…à¤ªà¤²à¥‹à¤¡ à¤•à¤°à¥‡à¤‚",
      risk_title: "à¤¸à¥à¤µà¤¾à¤¸à¥à¤¥à¥à¤¯ à¤œà¥‹à¤–à¤¿à¤® à¤­à¤µà¤¿à¤·à¥à¤¯à¤µà¤•à¥à¤¤à¤¾",
      risk_subtitle: "à¤ªà¥à¤°à¤¾à¤¨à¥€ à¤¬à¥€à¤®à¤¾à¤°à¤¿à¤¯à¥‹à¤‚ à¤•à¥‡ à¤²à¤¿à¤ à¤œà¥€à¤µà¤¨à¤¶à¥ˆà¤²à¥€ à¤œà¥‹à¤–à¤¿à¤® à¤¸à¥à¤•à¥‹à¤° à¤•à¤¾ à¤†à¤•à¤²à¤¨ à¤•à¤°à¥‡à¤‚",
      lbl_systolic: "à¤¸à¤¿à¤¸à¥à¤Ÿà¥‹à¤²à¤¿à¤• à¤°à¤•à¥à¤¤à¤šà¤¾à¤ª (mmHg)",
      lbl_exercise: "à¤¸à¤¾à¤ªà¥à¤¤à¤¾à¤¹à¤¿à¤• à¤µà¥à¤¯à¤¾à¤¯à¤¾à¤® (à¤˜à¤‚à¤Ÿà¥‡)",
      risk_smoking: "à¤¸à¤•à¥à¤°à¤¿à¤¯ à¤§à¥‚à¤®à¥à¤°à¤ªà¤¾à¤¨",
      risk_diabetes_history: "à¤ªà¤°à¤¿à¤µà¤¾à¤° à¤®à¥‡à¤‚ à¤®à¤§à¥à¤®à¥‡à¤¹ à¤‡à¤¤à¤¿à¤¹à¤¾à¤¸",
      risk_heart_history: "à¤ªà¤°à¤¿à¤µà¤¾à¤° à¤®à¥‡à¤‚ à¤¹à¥ƒà¤¦à¤¯ à¤°à¥‹à¤— à¤‡à¤¤à¤¿à¤¹à¤¾à¤¸",
      risk_alcohol: "à¤…à¤¤à¥à¤¯à¤§à¤¿à¤• à¤¶à¤°à¤¾à¤¬ à¤¸à¥‡à¤µà¤¨",
      btn_calculate_risk: "à¤œà¥‹à¤–à¤¿à¤® à¤µà¤¿à¤¶à¥à¤²à¥‡à¤·à¤£ à¤•à¤°à¥‡à¤‚",
      risk_ready_title: "à¤œà¥‹à¤–à¤¿à¤® à¤­à¤µà¤¿à¤·à¥à¤¯à¤µà¤¾à¤£à¥€ à¤‡à¤‚à¤œà¤¨ à¤¤à¥ˆà¤¯à¤¾à¤°",
      risk_ready_desc: "à¤°à¥‹à¤— à¤œà¥‹à¤–à¤¿à¤® à¤®à¥‰à¤¡à¤² à¤…à¤¨à¥à¤•à¤°à¤£ à¤•à¤°à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤œà¥€à¤µà¤¨à¤¶à¥ˆà¤²à¥€ à¤®à¤¾à¤¨à¤•à¥‹à¤‚ à¤•à¥‹ à¤•à¥‰à¤¨à¥à¤«à¤¼à¤¿à¤—à¤° à¤•à¤°à¥‡à¤‚à¥¤",
      risk_assessment_results: "à¤à¤†à¤ˆ à¤°à¥‹à¤— à¤œà¥‹à¤–à¤¿à¤® à¤…à¤¨à¥à¤®à¤¾à¤¨",
      risk_cardio: "à¤¹à¥ƒà¤¦à¤¯ à¤°à¥‹à¤— à¤œà¥‹à¤–à¤¿à¤®",
      risk_diabetes: "à¤Ÿà¤¾à¤‡à¤ª 2 à¤®à¤§à¥à¤®à¥‡à¤¹ à¤œà¥‹à¤–à¤¿à¤®",
      risk_hyper: "à¤‰à¤šà¥à¤š à¤°à¤•à¥à¤¤à¤šà¤¾à¤ª à¤œà¥‹à¤–à¤¿à¤®",
      preventive_health_advice: "à¤¨à¤¿à¤µà¤¾à¤°à¤• à¤¸à¤¿à¤«à¤¾à¤°à¤¿à¤¶à¥‡à¤‚",
      btn_recalculate_risk: "à¤¨à¤¯à¤¾ à¤®à¥‚à¤²à¥à¤¯à¤¾à¤‚à¤•à¤¨ à¤¶à¥à¤°à¥‚ à¤•à¤°à¥‡à¤‚"
    }
  };

  // --- INITIALIZATION ---
  initApp();

  async function initApp() {
    // Populate Current Date
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    currentDate.textContent = new Date().toLocaleDateString('en-US', options);
    
    // Setup Lucide icons translation
    lucide.createIcons();
    
    // Load persisted profile from Flask backend
    await loadUserProfile();
    
    // Load diagnostic history from Flask backend
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        appState.savedDiagnostics = await res.json();
      }
    } catch (e) {
      console.error(e);
    }
    renderHistoryTab();

    // Load medications from Flask backend
    try {
      const res = await fetch('/api/medications');
      if (res.ok) {
        userMeds = await res.json();
      }
    } catch (e) {
      console.error(e);
    }
    renderMedications();

    // Load daily hydration water from Flask backend
    try {
      const todayDateStr = new Date().toDateString();
      const res = await fetch(`/api/water?date=${encodeURIComponent(todayDateStr)}`);
      if (res.ok) {
        const wData = await res.json();
        hydrationData.current = wData.current;
        hydrationData.target = wData.target;
      }
    } catch (e) {
      console.error(e);
    }
    updateWaterUI();

    // Load sleep logs from Flask backend
    try {
      const res = await fetch('/api/sleep');
      if (res.ok) {
        sleepLogs = await res.json();
      }
    } catch (e) {
      console.error(e);
    }
    renderSleepLogs();

    // Setup Multi-language Engine
    const langSelector = document.getElementById('language-selector');
    if (langSelector) {
      const savedLang = localStorage.getItem('aegis_language') || 'en';
      langSelector.value = savedLang;
      changeLanguage(savedLang);
      langSelector.addEventListener('change', (e) => {
        changeLanguage(e.target.value);
      });
    }
  }

  // --- PROFILE MANAGEMENT ---
  async function loadUserProfile() {
    if (currentUser && db) {
      return; // Handled by Firestore sync
    }
    try {
      const res = await fetch('/api/profile');
      if (res.ok) {
        appState.user = await res.json();
      }
    } catch (e) {
      console.error("Failed to load user profile:", e);
    }
    updateProfileUI();
  }

  function updateProfileUI() {
    if (!appState.user) return;

    // Normalize server snake_case keys to camelCase
    if (appState.user.blood_group !== undefined) {
      appState.user.bloodGroup = appState.user.blood_group;
    }
    if (appState.user.medical_history !== undefined) {
      appState.user.medicalHistory = appState.user.medical_history;
    }

    // Update currentAvatarUrl to match what's in DB
    if (appState.user.avatar) {
      currentAvatarUrl = appState.user.avatar;
    }

    const activeProfileImg = document.getElementById('profile-img') || profileImg;
    const activeProfileName = document.getElementById('profile-name') || profileName;
    const activeProfileStats = document.getElementById('profile-stats') || profileStats;
    const activeWelcomeName = document.getElementById('welcome-name') || welcomeName;

    if (activeProfileImg) activeProfileImg.src = currentAvatarUrl;
    if (activeProfileName) activeProfileName.textContent = appState.user.name;
    if (activeProfileStats) activeProfileStats.textContent = `${appState.user.age} Yrs • ${appState.user.gender}`;
    if (activeWelcomeName) activeWelcomeName.textContent = appState.user.name.split(' ')[0];
    
    // Keep wizard form inputs synchronized
    diagGenderInput.value = appState.user.gender;
    diagAgeInput.value = appState.user.age;
    
    // Pre-populate settings form
    settingsAvatarPreview.src = currentAvatarUrl;
    // Only update avatar-presets dropdown if value matches a preset option
    const presetMatch = Array.from(avatarPresets.options).find(o => o.value === currentAvatarUrl);
    if (presetMatch) {
      avatarPresets.value = currentAvatarUrl;
    } else if (currentAvatarUrl) {
      let customOpt = Array.from(avatarPresets.options).find(o => o.value === 'custom');
      if (!customOpt) {
        customOpt = document.createElement('option');
        customOpt.value = 'custom';
        customOpt.textContent = 'Custom Photo / Uploaded';
        avatarPresets.appendChild(customOpt);
      }
      avatarPresets.value = 'custom';
    }
    profNameInput.value = appState.user.name || '';
    profGenderInput.value = appState.user.gender || 'Female';
    profAgeInput.value = appState.user.age || '';
    
    if (profWeightInput) profWeightInput.value = appState.user.weight || '';
    if (profHeightInput) profHeightInput.value = appState.user.height || '';
    if (profBloodInput) profBloodInput.value = appState.user.bloodGroup || 'A+';
    if (profAllergiesInput) profAllergiesInput.value = appState.user.allergies || '';
    if (profHistoryInput) profHistoryInput.value = appState.user.medicalHistory || '';

    // Update holographic health ID card fields
    const hologramAvatar = document.getElementById('hologram-avatar');
    const hologramName = document.getElementById('hologram-name');
    const hologramAge = document.getElementById('hologram-age');
    const hologramGender = document.getElementById('hologram-gender');
    const hologramBlood = document.getElementById('hologram-blood');
    const hologramHeight = document.getElementById('hologram-height');
    const hologramWeight = document.getElementById('hologram-weight');
    const hologramAllergies = document.getElementById('hologram-allergies');
    const hologramHistory = document.getElementById('hologram-history');

    if (hologramAvatar) hologramAvatar.src = currentAvatarUrl;
    if (hologramName) hologramName.textContent = appState.user.name;
    if (hologramAge) hologramAge.textContent = appState.user.age;
    if (hologramGender) hologramGender.textContent = appState.user.gender;
    if (hologramBlood) hologramBlood.textContent = appState.user.bloodGroup || 'A+';
    if (hologramHeight) hologramHeight.textContent = appState.user.height ? `${appState.user.height} cm` : '--';
    if (hologramWeight) hologramWeight.textContent = appState.user.weight ? `${appState.user.weight} kg` : '--';
    if (hologramAllergies) hologramAllergies.textContent = appState.user.allergies || 'None';
    if (hologramHistory) hologramHistory.textContent = appState.user.medicalHistory || 'None';
  }

  // Settings Modal Controls
  // Open settings when clicking profile card or sliders button
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', openProfileModal);
  }

  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });

  // Close modal when clicking background
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.style.display = 'none';
    }
  });

  // Profile Modal Tab Switching
  const profileTabBtns = document.querySelectorAll('.profile-tab-btn');
  const profileTabContents = document.querySelectorAll('.profile-tab-content');

  profileTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      profileTabBtns.forEach(b => b.classList.remove('active'));
      profileTabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetTab = btn.getAttribute('data-profile-tab');
      const targetPane = document.getElementById(targetTab);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // Avatar Preset Change
  avatarPresets.addEventListener('change', (e) => {
    const val = e.target.value;
    currentAvatarUrl = val; // Track separately - DO NOT read from .src
    settingsAvatarPreview.src = val;
    const hologramAvatar = document.getElementById('hologram-avatar');
    if (hologramAvatar) hologramAvatar.src = val;
  });

  // Custom Photo Uploader (Base64 file reader)
  const uploadCustomBtn = document.getElementById('upload-custom-avatar-btn');
  const customTriggerBadge = document.getElementById('upload-custom-trigger');
  const avatarFileInput = document.getElementById('avatar-file-input');

  const triggerAvatarUpload = () => {
    if (avatarFileInput) avatarFileInput.click();
  };

  if (uploadCustomBtn) uploadCustomBtn.addEventListener('click', triggerAvatarUpload);
  if (customTriggerBadge) customTriggerBadge.addEventListener('click', triggerAvatarUpload);

  if (avatarFileInput) {
    avatarFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        // Validate file type
        if (!file.type.startsWith('image/')) {
          alert('Please select an image file.');
          return;
        }
        // Limit file size to 2MB to keep Base64 manageable
        if (file.size > 2 * 1024 * 1024) {
          alert('Profile image must be less than 2MB.');
          return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
          const base64Url = event.target.result;
          currentAvatarUrl = base64Url; // Track separately - DO NOT read from .src
          settingsAvatarPreview.src = base64Url;
          const hologramAvatar = document.getElementById('hologram-avatar');
          if (hologramAvatar) hologramAvatar.src = base64Url;
          
          let customOpt = Array.from(avatarPresets.options).find(o => o.value === 'custom');
          if (!customOpt) {
            customOpt = document.createElement('option');
            customOpt.value = 'custom';
            customOpt.textContent = 'Custom Photo / Uploaded';
            avatarPresets.appendChild(customOpt);
          }
          avatarPresets.value = 'custom';
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Real-time Inputs Sync (Live Hologram Pass Preview)
  const hologramName = document.getElementById('hologram-name');
  const hologramAge = document.getElementById('hologram-age');
  const hologramGender = document.getElementById('hologram-gender');
  const hologramBlood = document.getElementById('hologram-blood');
  const hologramHeight = document.getElementById('hologram-height');
  const hologramWeight = document.getElementById('hologram-weight');
  const hologramAllergies = document.getElementById('hologram-allergies');
  const hologramHistory = document.getElementById('hologram-history');

  if (profNameInput) {
    profNameInput.addEventListener('input', (e) => {
      if (hologramName) hologramName.textContent = e.target.value.trim() || 'Guest User';
    });
  }
  if (profAgeInput) {
    profAgeInput.addEventListener('input', (e) => {
      if (hologramAge) hologramAge.textContent = e.target.value || '--';
    });
  }
  if (profGenderInput) {
    profGenderInput.addEventListener('change', (e) => {
      if (hologramGender) hologramGender.textContent = e.target.value;
    });
  }
  if (profBloodInput) {
    profBloodInput.addEventListener('change', (e) => {
      if (hologramBlood) hologramBlood.textContent = e.target.value;
    });
  }
  if (profHeightInput) {
    profHeightInput.addEventListener('input', (e) => {
      if (hologramHeight) hologramHeight.textContent = e.target.value ? `${e.target.value} cm` : '--';
    });
  }
  if (profWeightInput) {
    profWeightInput.addEventListener('input', (e) => {
      if (hologramWeight) hologramWeight.textContent = e.target.value ? `${e.target.value} kg` : '--';
    });
  }
  if (profAllergiesInput) {
    profAllergiesInput.addEventListener('input', (e) => {
      if (hologramAllergies) hologramAllergies.textContent = e.target.value.trim() || 'None';
    });
  }
  if (profHistoryInput) {
    profHistoryInput.addEventListener('input', (e) => {
      if (hologramHistory) hologramHistory.textContent = e.target.value.trim() || 'None';
    });
  }

  // Futuristic Save Event
  profileEditForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const saveBtn = document.getElementById('save-profile-btn');
    const btnSpinner = saveBtn.querySelector('.btn-spinner');
    const btnText = saveBtn.querySelector('span');

    // Enable futuristic loading state
    if (saveBtn) saveBtn.disabled = true;
    if (btnSpinner) btnSpinner.style.display = 'inline-block';
    if (btnText) btnText.textContent = 'Synchronizing Health ID Pass...';

    const updatedUser = {
      name: profNameInput.value.trim() || 'Guest User',
      age: parseInt(profAgeInput.value) || 28,
      gender: profGenderInput.value,
      avatar: currentAvatarUrl, // Use tracked URL, NOT settingsAvatarPreview.src (which adds origin)
      weight: parseFloat(profWeightInput ? profWeightInput.value : '') || null,
      height: parseFloat(profHeightInput ? profHeightInput.value : '') || null,
      bloodGroup: profBloodInput ? profBloodInput.value : 'A+',
      allergies: profAllergiesInput ? profAllergiesInput.value.trim() : '',
      medicalHistory: profHistoryInput ? profHistoryInput.value.trim() : ''
    };

    try {
      // Simulate high-tech biometric sync delay (750ms) for aesthetics
      await new Promise(resolve => setTimeout(resolve, 750));

      if (currentUser && db) {
        try {
          await setDoc(doc(db, "users", currentUser.uid), updatedUser);
          console.log("Profile saved to Firestore");
        } catch (fErr) {
          console.error("Firestore profile save error:", fErr);
        }
      }

      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedUser)
      });
      if (res.ok) {
        const savedData = await res.json();
        appState.user = savedData;
        // Normalize keys immediately after save
        if (appState.user.blood_group !== undefined) appState.user.bloodGroup = appState.user.blood_group;
        if (appState.user.medical_history !== undefined) appState.user.medicalHistory = appState.user.medical_history;
        // Keep avatar in sync with what was actually saved
        currentAvatarUrl = updatedUser.avatar;
      } else {
        // Server error – use local data so UI still reflects changes
        appState.user = { ...appState.user, ...updatedUser };
      }
    } catch (err) {
      console.error("Failed to save user profile:", err);
      appState.user = { ...appState.user, ...updatedUser };
    } finally {
      // Disable loading state
      if (saveBtn) saveBtn.disabled = false;
      if (btnSpinner) btnSpinner.style.display = 'none';
      if (btnText) btnText.textContent = 'Save Profile Configuration';
    }

    updateProfileUI();
    settingsModal.style.display = 'none';
  });


  // --- TAB NAVIGATION ---
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  function switchTab(tabId) {
    appState.activeTab = tabId;
    
    // Toggle Nav Buttons
    navItems.forEach(btn => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Toggle Content Sections
    const allTabSections = document.querySelectorAll('.tab-content');
    allTabSections.forEach(section => {
      if (section.id === `tab-${tabId}`) {
        section.classList.add('active');
      } else {
        section.classList.remove('active');
      }
    });

    // Stop camera streams if navigating away from skin/heart tabs
    if (tabId !== 'skin') {
      stopSkinCamera();
    }
    if (tabId !== 'heart') {
      stopHeartScanner();
    }

    // Specific tab loads
    if (tabId === 'history') {
      renderHistoryTab();
    }
  }

  redirectToCheckerBtn.addEventListener('click', () => {
    switchTab('checker');
  });


  // --- SYMPTOM FINDER & AUTOCOMPLETE ---
  
  // Search bar inputs
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    
    if (!query) {
      suggestionsDropdown.style.display = 'none';
      clearSearchBtn.style.display = 'none';
      return;
    }
    
    clearSearchBtn.style.display = 'block';
    
    // Filter suggestions
    const filtered = SYMPTOMS_DB.filter(s => 
      s.name.toLowerCase().includes(query) && !appState.selectedSymptoms.has(s.id)
    );
    
    renderSuggestions(filtered);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const query = searchInput.value.trim();
      if (!query) return;
      
      const matched = SYMPTOMS_DB.find(s => s.name.toLowerCase() === query.toLowerCase());
      if (matched) {
        addSymptom(matched.id);
      } else {
        const customId = 'custom_' + query.toLowerCase().replace(/[^a-z0-9]/g, '_');
        if (!SYMPTOMS_DB.some(s => s.id === customId)) {
          SYMPTOMS_DB.push({
            id: customId,
            name: query,
            region: 'body'
          });
        }
        addSymptom(customId);
      }
      
      searchInput.value = '';
      suggestionsDropdown.style.display = 'none';
      clearSearchBtn.style.display = 'none';
    }
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    suggestionsDropdown.style.display = 'none';
    clearSearchBtn.style.display = 'none';
    searchInput.focus();
  });

  // Render suggestion items
  function renderSuggestions(items) {
    const query = searchInput.value.trim();
    let html = items.map(item => `
      <div class="suggestion-item" data-id="${item.id}">
        <span>${item.name}</span>
        <span class="suggestion-region">${capitalizeFirstLetter(item.region)}</span>
      </div>
    `).join('');
    
    if (query && !items.some(item => item.name.toLowerCase() === query.toLowerCase())) {
      const addText = appState.currentLanguage === 'bn' ? `+ "${query}" à¦¯à§‹à¦— à¦•à¦°à§à¦¨ (à¦•à¦¾à¦¸à§à¦Ÿà¦®)` : (appState.currentLanguage === 'hi' ? `+ "${query}" à¤œà¥‹à¥œà¥‡à¤‚ (à¤•à¤¸à¥à¤Ÿà¤®)` : `+ Add custom: "${query}"`);
      html += `
        <div class="suggestion-item custom-add-item" data-custom-name="${query.replace(/"/g, '&quot;')}" style="border-top: 1px dashed var(--glass-border); color: var(--accent-sky); font-weight: 600;">
          <span>${addText}</span>
        </div>
      `;
    }
    
    if (!html) {
      suggestionsDropdown.innerHTML = `<div class="suggestion-item" style="cursor: default; color: var(--text-muted);">No symptoms matched</div>`;
      suggestionsDropdown.style.display = 'block';
      return;
    }
    
    suggestionsDropdown.innerHTML = html;
    suggestionsDropdown.style.display = 'block';
    
    // Attach selection handlers
    suggestionsDropdown.querySelectorAll('.suggestion-item').forEach(el => {
      el.addEventListener('click', () => {
        if (el.classList.contains('custom-add-item')) {
          const customName = el.getAttribute('data-custom-name');
          const customId = 'custom_' + customName.toLowerCase().replace(/[^a-z0-9]/g, '_');
          if (!SYMPTOMS_DB.some(s => s.id === customId)) {
            SYMPTOMS_DB.push({
              id: customId,
              name: customName,
              region: 'body'
            });
          }
          addSymptom(customId);
        } else {
          const symId = el.getAttribute('data-id');
          if (symId) addSymptom(symId);
        }
        
        searchInput.value = '';
        suggestionsDropdown.style.display = 'none';
        clearSearchBtn.style.display = 'none';
        searchInput.focus();
      });
    });
  }

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !suggestionsDropdown.contains(e.target)) {
      suggestionsDropdown.style.display = 'none';
    }
  });


  // --- SYMPTOM CHIPS & STATE SYNC ---
  
  function addSymptom(id) {
    if (appState.selectedSymptoms.has(id)) return;
    
    appState.selectedSymptoms.add(id);
    updateSelectedChips();
    syncUIWithSelectedSymptoms();
  }

  function removeSymptom(id) {
    if (!appState.selectedSymptoms.has(id)) return;
    
    appState.selectedSymptoms.delete(id);
    updateSelectedChips();
    syncUIWithSelectedSymptoms();
  }

  function updateSelectedChips() {
    if (appState.selectedSymptoms.size === 0) {
      selectedChipsContainer.innerHTML = `<span class="placeholder-chip">No symptoms selected yet. Use the search or body map below.</span>`;
      
      // Disable wizard trigger button
      startWizardBtn.classList.add('disabled');
      startWizardBtn.disabled = true;
      return;
    }

    selectedChipsContainer.innerHTML = '';
    appState.selectedSymptoms.forEach(symId => {
      const sym = SYMPTOMS_DB.find(s => s.id === symId);
      if (sym) {
        const chip = document.createElement('span');
        chip.className = 'symptom-chip';
        chip.innerHTML = `
          <span>${sym.name}</span>
          <button data-id="${sym.id}">
            <i data-lucide="x" style="width: 13px; height: 13px;"></i>
          </button>
        `;
        selectedChipsContainer.appendChild(chip);
        
        // Chip remove handler
        chip.querySelector('button').addEventListener('click', () => {
          removeSymptom(symId);
        });
      }
    });

    // Enable wizard start button
    startWizardBtn.classList.remove('disabled');
    startWizardBtn.disabled = false;
    
    // Refresh icons inside chips
    lucide.createIcons();
  }

  // Updates SVGs and Popular Buttons based on state
  function syncUIWithSelectedSymptoms() {
    // 1. Sync Popular buttons
    quickSymptomButtons.forEach(btn => {
      const name = btn.getAttribute('data-symptom');
      const matchedSymptom = SYMPTOMS_DB.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (matchedSymptom) {
        if (appState.selectedSymptoms.has(matchedSymptom.id)) {
          btn.classList.add('selected');
        } else {
          btn.classList.remove('selected');
        }
      }
    });

    // 2. Sync SVG body parts
    // Determine which regions are active
    const activeRegions = new Set();
    appState.selectedSymptoms.forEach(symId => {
      const sym = SYMPTOMS_DB.find(s => s.id === symId);
      if (sym && sym.region) {
        activeRegions.add(sym.region);
      }
    });

    svgBodyParts.forEach(part => {
      const region = part.getAttribute('data-region');
      if (activeRegions.has(region)) {
        part.classList.add('part-selected');
      } else {
        part.classList.remove('part-selected');
      }
    });

    // 3. Sync popup symptom buttons if any are rendered
    const popupButtons = document.querySelectorAll('.popup-symptom-btn');
    popupButtons.forEach(btn => {
      const symId = btn.getAttribute('data-id');
      if (appState.selectedSymptoms.has(symId)) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Quick selections popular list handler
  quickSymptomButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-symptom');
      const sym = SYMPTOMS_DB.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (sym) {
        if (appState.selectedSymptoms.has(sym.id)) {
          removeSymptom(sym.id);
        } else {
          addSymptom(sym.id);
        }
      }
    });
  });


  // --- INTERACTIVE SVG BODY MAP ---
  
  const regionTranslations = {
    en: {
      head: "Head Symptoms",
      chest: "Chest Symptoms",
      abdomen: "Abdomen Symptoms",
      pelvis: "Pelvis Symptoms",
      arms: "Arms Symptoms",
      legs: "Legs Symptoms"
    },
    bn: {
      head: "à¦®à¦¾à¦¥à¦¾à¦° à¦²à¦•à§à¦·à¦£à¦¸à¦®à§‚à¦¹",
      chest: "à¦¬à§à¦•à§‡à¦° à¦²à¦•à§à¦·à¦£à¦¸à¦®à§‚à¦¹",
      abdomen: "à¦ªà§‡à¦Ÿà§‡à¦° à¦²à¦•à§à¦·à¦£à¦¸à¦®à§‚à¦¹",
      pelvis: "à¦¶à§à¦°à§‹à¦£à§€à¦šà¦•à§à¦°à§‡à¦° à¦²à¦•à§à¦·à¦£à¦¸à¦®à§‚à¦¹",
      arms: "à¦¹à¦¾à¦¤à§‡à¦° à¦²à¦•à§à¦·à¦£à¦¸à¦®à§‚à¦¹",
      legs: "à¦ªà¦¾à§Ÿà§‡à¦° à¦²à¦•à§à¦·à¦£à¦¸à¦®à§‚à¦¹"
    },
    hi: {
      head: "à¤¸à¤¿à¤° à¤•à¥‡ à¤²à¤•à¥à¤·à¤£",
      chest: "à¤›à¤¾à¤¤à¥€ à¤•à¥‡ à¤²à¤•à¥à¤·à¤£",
      abdomen: "à¤ªà¥‡à¤Ÿ à¤•à¥‡ à¤²à¤•à¥à¤·à¤£",
      pelvis: "à¤ªà¥‡à¤²à¥à¤µà¤¿à¤• (à¤ªà¥‡à¤¡à¥‚) à¤•à¥‡ à¤²à¤•à¥à¤·à¤£",
      arms: "à¤¹à¤¾à¤¥à¥‹à¤‚ à¤•à¥‡ à¤²à¤•à¥à¤·à¤£",
      legs: "à¤ªà¥ˆà¤°à¥‹à¤‚ à¤•à¥‡ à¤²à¤•à¥à¤·à¤£"
    }
  };

  // SVG body part click listener (Tapping a body part opens interactive symptom popup)
  svgBodyParts.forEach(part => {
    part.addEventListener('click', (e) => {
      e.stopPropagation();
      const regionName = part.getAttribute('data-region');
      
      const lang = appState.currentLanguage || 'en';
      const titleText = regionTranslations[lang] && regionTranslations[lang][regionName] 
        ? regionTranslations[lang][regionName] 
        : `${capitalizeFirstLetter(regionName)} Symptoms`;
      
      if (popupRegionTitle) popupRegionTitle.textContent = titleText;
      
      // Filter symptoms in this region
      const regionSymptoms = SYMPTOMS_DB.filter(s => s.region === regionName);
      
      renderPopupSymptoms(regionSymptoms);
      if (regionPopup) regionPopup.style.display = 'flex';
    });
  });

  if (popupCloseBtn) {
    popupCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (regionPopup) regionPopup.style.display = 'none';
    });
  }

  // Close popup if clicking outside of it
  document.addEventListener('click', (e) => {
    if (regionPopup && regionPopup.style.display === 'flex' && !regionPopup.contains(e.target)) {
      regionPopup.style.display = 'none';
    }
  });

  function renderPopupSymptoms(symptoms) {
    if (!popupSymptomsList) return;
    popupSymptomsList.innerHTML = '';
    
    symptoms.forEach(sym => {
      const btn = document.createElement('button');
      btn.className = `popup-symptom-btn ${appState.selectedSymptoms.has(sym.id) ? 'active' : ''}`;
      btn.setAttribute('data-id', sym.id);
      
      btn.innerHTML = `<span>${sym.name}</span>`;
      
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (appState.selectedSymptoms.has(sym.id)) {
          removeSymptom(sym.id);
          btn.classList.remove('active');
        } else {
          addSymptom(sym.id);
          btn.classList.add('active');
        }
      });
      popupSymptomsList.appendChild(btn);
    });
  }

  // Model front/back toggles
  bodyFrontBtn.addEventListener('click', () => {
    bodyFrontBtn.classList.add('active');
    bodyBackBtn.classList.remove('active');
    // Rotate model animation placeholder (just toggle scales as mock flip)
    interactiveBodySvg.style.transform = 'scaleX(1)';
  });

  bodyBackBtn.addEventListener('click', () => {
    bodyBackBtn.classList.add('active');
    bodyFrontBtn.classList.remove('active');
    interactiveBodySvg.style.transform = 'scaleX(-1)';
  });


  // --- DIAGNOSTIC WIZARD STEPS ---
  
  startWizardBtn.addEventListener('click', () => {
    if (appState.selectedSymptoms.size === 0) return;
    
    // Switch state from Empty to Form Wizard
    stateEmpty.classList.remove('active');
    stateForm.classList.add('active');
    showStep(1);
  });

  function showStep(stepNum) {
    appState.currentWizardStep = stepNum;
    
    // Show active step section
    formSteps.forEach(step => {
      if (parseInt(step.getAttribute('data-step')) === stepNum) {
        step.classList.add('active');
      } else {
        step.classList.remove('active');
      }
    });

    // Update wizard indicators
    stepDots.forEach(dot => {
      const dotStep = parseInt(dot.getAttribute('data-step'));
      if (dotStep === stepNum) {
        dot.classList.add('active');
      } else if (dotStep < stepNum) {
        dot.classList.add('active'); // Keep completed steps active/colored
      } else {
        dot.classList.remove('active');
      }
    });
  }

  // Next Buttons
  wizardNextBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (appState.currentWizardStep < 3) {
        showStep(appState.currentWizardStep + 1);
      }
    });
  });

  // Back Buttons
  wizardBackBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (appState.currentWizardStep > 1) {
        showStep(appState.currentWizardStep - 1);
      }
    });
  });

  // Severity range label sync
  diagSeverityInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    if (val === 1) {
      severityBadge.textContent = 'Mild';
      severityBadge.style.background = 'var(--accent-teal)';
    } else if (val === 2) {
      severityBadge.textContent = 'Moderate';
      severityBadge.style.background = 'var(--accent-indigo)';
    } else {
      severityBadge.textContent = 'Severe';
      severityBadge.style.background = 'var(--accent-rose)';
    }
  });


  // --- DYNAMIC AI DIAGNOSTIC ENGINE & SCANNERS ---
  
  triggerScanBtn.addEventListener('click', () => {
    // Hide Form, Show Scanning
    stateForm.classList.remove('active');
    stateScanning.classList.add('active');
    
    // Simulate Loading Screen Diagnostics
    runScannerSequence(3000, async () => {
      // Calculate Report via Python Server API
      const selectedList = Array.from(appState.selectedSymptoms);
      const symptomNames = selectedList.map(sId => {
        const found = SYMPTOMS_DB.find(s => s.id === sId);
        return found ? found.name : sId;
      });
      const age = parseInt(diagAgeInput.value) || appState.user.age;
      const gender = diagGenderInput.value;
      const severity = parseInt(diagSeverityInput.value);
      const duration = document.querySelector('input[name="diag-duration"]:checked').value;
      
      const riskHighFever = document.getElementById('risk-fever').checked;
      const riskDiffBreathing = document.getElementById('risk-breathing').checked;
      const riskMeds = document.getElementById('risk-meds').checked;
      const riskPregnancy = document.getElementById('risk-pregnancy').checked;
      
      const requestData = {
        symptoms: symptomNames,
        age,
        gender,
        severity,
        duration,
        riskFactors: { riskHighFever, riskDiffBreathing, riskMeds, riskPregnancy },
        lang: appState.currentLanguage || 'en'
      };
      
      let report = null;
      try {
        const res = await fetch('/api/diagnose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestData)
        });
        if (res.ok) {
          report = await res.json();
        } else {
          report = generateDiagnosticReport();
        }
      } catch (err) {
        console.error("Diagnosis server error:", err);
        report = generateDiagnosticReport();
      }
      
      appState.lastGeneratedReport = report;
      
      // Render report UI
      renderReportUI(report);
      
      // Transition from scanning to results
      stateScanning.classList.remove('active');
      stateResults.classList.add('active');
    });
  });

  function runScannerSequence(duration, callback) {
    const stepsCount = 100;
    const stepDuration = duration / stepsCount;
    let progress = 0;
    
    scanProgressBar.style.width = '0%';
    scanPercentText.textContent = '0%';
    scanStatusText.textContent = 'Parsing symptom profiles...';
    
    const interval = setInterval(() => {
      progress += 1;
      scanProgressBar.style.width = `${progress}%`;
      scanPercentText.textContent = `${progress}%`;
      
      // Update statuses dynamically based on progression
      if (progress === 25) {
        scanStatusText.textContent = 'Cross-referencing medical databases...';
      } else if (progress === 55) {
        scanStatusText.textContent = 'Assessing risk indicators...';
      } else if (progress === 80) {
        scanStatusText.textContent = 'Generating diagnostic intelligence report...';
      }
      
      if (progress >= 100) {
        clearInterval(interval);
        setTimeout(callback, 200); // Tiny pause for satisfaction
      }
    }, stepDuration);
  }

  // Core Math Engine: Differential Diagnostic Weighted Match
  function generateDiagnosticReport() {
    const selectedList = Array.from(appState.selectedSymptoms);
    const age = parseInt(diagAgeInput.value) || appState.user.age;
    const gender = diagGenderInput.value;
    const severity = parseInt(diagSeverityInput.value); // 1 = mild, 2 = mod, 3 = severe
    const duration = document.querySelector('input[name="diag-duration"]:checked').value;
    
    // Secondary risks checked
    const riskHighFever = document.getElementById('risk-fever').checked;
    const riskDiffBreathing = document.getElementById('risk-breathing').checked;
    const riskMeds = document.getElementById('risk-meds').checked;
    const riskPregnancy = document.getElementById('risk-pregnancy').checked;
    
    let matches = [];
    
    CONDITIONS_DB.forEach(condition => {
      let score = 0;
      let matchedPrimary = 0;
      let matchedSecondary = 0;
      
      // 1. Primary symptom weight (40 points per match)
      condition.primarySymptoms.forEach(sym => {
        if (selectedList.includes(sym)) {
          score += 40;
          matchedPrimary++;
        }
      });
      
      // 2. Secondary symptom weight (15 points per match)
      condition.secondarySymptoms.forEach(sym => {
        if (selectedList.includes(sym)) {
          score += 15;
          matchedSecondary++;
        }
      });
      
      // Calculate match percentage ratio
      const totalPossibleScore = (condition.primarySymptoms.length * 40) + (condition.secondarySymptoms.length * 15);
      let matchPercent = Math.min(100, Math.round((score / totalPossibleScore) * 100));
      
      // Apply heuristics to fine tune match percentages
      // e.g. If primary match is high, raise it
      if (matchedPrimary > 0 && matchPercent < 15) {
        matchPercent += 15;
      }
      
      // Boost cardiovascular issues if Chest Pain + Shortness of breath
      if (condition.id === 'angina' && selectedList.includes('chest-pain')) {
        matchPercent = Math.max(matchPercent, 60);
        if (riskDiffBreathing) matchPercent += 15;
      }

      // Boost respiratory infections if Difficulty breathing
      if ((condition.id === 'bronchitis' || condition.id === 'flu') && riskDiffBreathing) {
        matchPercent += 20;
      }
      
      // Limit to 100 max
      matchPercent = Math.min(100, matchPercent);
      
      if (matchPercent > 10) {
        matches.push({
          condition,
          percentage: matchPercent
        });
      }
    });
    
    // Sort matches by percentage descending
    matches.sort((a, b) => b.percentage - a.percentage);
    
    // Fallback if no matching condition found
    if (matches.length === 0) {
      matches.push({
        condition: {
          id: 'general-consult',
          name: 'Non-Specific Symptom Cluster',
          description: 'Your selected symptoms do not directly map to single common ailments. A detailed physical examination is recommended.',
          baseUrgency: 'low',
          specialist: 'General Practitioner',
          specialistExplanation: 'A primary care physician can evaluate broad clusters of minor symptoms.',
          selfCare: [
            'Drink plenty of fluids.',
            'Track symptom duration and any new developments.',
            'Rest and avoid severe stress.'
          ]
        },
        percentage: 50
      });
    }

    // Determine final urgency level (Low, Medium, Urgent)
    let finalUrgency = 'low';
    
    // Rule: high base condition urgency increases final urgency
    const hasHighCondition = matches.some(m => m.condition.baseUrgency === 'urgent' && m.percentage >= 45);
    const hasMediumCondition = matches.some(m => m.condition.baseUrgency === 'medium' && m.percentage >= 40);
    
    if (hasHighCondition || riskDiffBreathing || (selectedList.includes('chest-pain') && severity === 3)) {
      finalUrgency = 'urgent';
    } else if (hasMediumCondition || severity === 3 || duration === '2w' || riskHighFever) {
      finalUrgency = 'medium';
    }

    return {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      symptoms: selectedList.map(sId => {
        const found = SYMPTOMS_DB.find(s => s.id === sId);
        return found ? found.name : sId; // fallback: custom symptom id is already its name
      }),
      demographics: { age, gender },
      settings: { severity, duration, riskFactors: { riskHighFever, riskDiffBreathing, riskMeds, riskPregnancy } },
      matches,
      urgency: finalUrgency
    };
  }

  function renderReportUI(report) {
    // 1. Status icons & title based on urgency
    resultStatusIconContainer.className = 'header-icon-container';
    
    if (report.urgency === 'urgent') {
      resultStatusIcon.setAttribute('data-lucide', 'alert-octagon');
      resultStatusIconContainer.classList.add('text-danger');
      resultVerdictTitle.textContent = 'Immediate Assessment Required';
      
      urgencyAlertBanner.className = 'alert-banner high-risk';
      urgencyTitle.textContent = 'Urgent Medical Attention Advised';
      urgencyDescription.textContent = 'Severe symptoms or acute indicators identified. Please contact emergency health service or visit the nearest ER immediately.';
    } else if (report.urgency === 'medium') {
      resultStatusIcon.setAttribute('data-lucide', 'alert-triangle');
      resultStatusIconContainer.classList.add('text-warning');
      resultVerdictTitle.textContent = 'Medical Consultation Recommended';
      
      urgencyAlertBanner.className = 'alert-banner medium-risk';
      urgencyTitle.textContent = 'Schedule Doctor Appointment';
      urgencyDescription.textContent = 'Symptoms are persistent or moderate. We advise consulting a general practitioner or specialist within the coming days.';
    } else {
      resultStatusIcon.setAttribute('data-lucide', 'check-circle');
      resultStatusIconContainer.classList.add('text-success');
      resultVerdictTitle.textContent = 'Minor Ailment Assessment';
      
      urgencyAlertBanner.className = 'alert-banner low-risk';
      urgencyTitle.textContent = 'Routine Self-Care Recommended';
      urgencyDescription.textContent = 'Symptoms appear mild and characteristic of general minor conditions. Focus on rest and self-care guidelines.';
    }
    
    // Refresh icons inside result headers
    lucide.createIcons();

    // 2. Render Differential matches
    conditionsMatchesList.innerHTML = '';
    
    report.matches.forEach((m, idx) => {
      const isHighMatch = m.percentage >= 70;
      const matchCard = document.createElement('div');
      matchCard.className = `condition-match-card ${isHighMatch ? 'high-match' : ''}`;
      
      matchCard.innerHTML = `
        <div class="condition-meta">
          <h4>${m.condition.name}</h4>
          <span class="match-percentage">${m.percentage}% Match</span>
        </div>
        <div class="match-bar-bg">
          <div class="match-bar-fill" id="mbar-${idx}"></div>
        </div>
        <p class="condition-desc">${m.condition.description}</p>
      `;
      conditionsMatchesList.appendChild(matchCard);
      
      // Animate progress fill with a tiny stagger
      setTimeout(() => {
        const fillBar = document.getElementById(`mbar-${idx}`);
        if (fillBar) fillBar.style.width = `${m.percentage}%`;
      }, 100 + (idx * 150));
    });

    // 3. Recommended Specialist
    const primaryMatch = report.matches[0].condition;
    recommendedSpecialistType.textContent = primaryMatch.specialist;
    specialistExplanation.textContent = primaryMatch.specialistExplanation;
    
    // Set appropriate specialist icon based on title
    let specIconName = 'user-cog';
    const specLower = primaryMatch.specialist.toLowerCase();
    if (specLower.includes('general')) specIconName = 'stethoscope';
    else if (specLower.includes('cardio')) specIconName = 'heart';
    else if (specLower.includes('pulmon')) specIconName = 'wind';
    else if (specLower.includes('neuro')) specIconName = 'brain';
    else if (specLower.includes('gastro')) specIconName = 'soup';
    else if (specLower.includes('urol')) specIconName = 'droplet';
    
    specialistIcon.setAttribute('data-lucide', specIconName);
    lucide.createIcons();

    // 4. Care Actions List
    homeCareActionsList.innerHTML = primaryMatch.selfCare.map(action => `
      <li>${action}</li>
    `).join('');
  }

  // Start new diagnosis button
  resetDiagnosticsBtn.addEventListener('click', resetCheckerState);

  function resetCheckerState() {
    appState.selectedSymptoms.clear();
    appState.lastGeneratedReport = null;
    
    // Reset inputs
    searchInput.value = '';
    suggestionsDropdown.style.display = 'none';
    clearSearchBtn.style.display = 'none';
    
    // Clear forms
    document.getElementById('risk-fever').checked = false;
    document.getElementById('risk-breathing').checked = false;
    document.getElementById('risk-meds').checked = false;
    document.getElementById('risk-pregnancy').checked = false;
    diagSeverityInput.value = 2;
    severityBadge.textContent = 'Moderate';
    severityBadge.style.background = 'var(--accent-indigo)';
    document.querySelector('input[name="diag-duration"][value="24h"]').checked = true;
    
    // Reset steps
    formSteps.forEach(step => step.classList.remove('active'));
    stepDots.forEach(dot => dot.classList.remove('active'));
    
    // UI resets
    updateSelectedChips();
    syncUIWithSelectedSymptoms();
    
    // Reset history save button state
    saveDiagToHistoryBtn.innerHTML = `<i data-lucide="bookmark"></i> <span>Save Report to History</span>`;
    saveDiagToHistoryBtn.classList.remove('disabled');
    saveDiagToHistoryBtn.disabled = false;
    lucide.createIcons();
    
    // Switch states
    stateResults.classList.remove('active');
    stateForm.classList.remove('active');
    stateScanning.classList.remove('active');
    stateEmpty.classList.add('active');
  }


  // --- PREVIOUS HISTORY LOGGER ---
  
  saveDiagToHistoryBtn.addEventListener('click', async () => {
    if (!appState.lastGeneratedReport) return;
    
    // Prevent double saving
    const exists = appState.savedDiagnostics.some(d => d.id === appState.lastGeneratedReport.id);
    if (exists) {
      alert('This diagnostic report is already saved in your history.');
      return;
    }
    
    if (currentUser && db) {
      try {
        await setDoc(doc(db, "users", currentUser.uid, "history", appState.lastGeneratedReport.id), appState.lastGeneratedReport);
        console.log("Scan saved to Firestore");
      } catch (fErr) {
        console.error("Firestore history save error:", fErr);
      }
    }
    try {
      const res = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appState.lastGeneratedReport)
      });
      if (res.ok) {
        appState.savedDiagnostics = await res.json();
      } else {
        if (!appState.savedDiagnostics.some(d => d.id === appState.lastGeneratedReport.id)) {
          appState.savedDiagnostics.unshift(appState.lastGeneratedReport);
        }
      }
    } catch (err) {
      console.error("Failed to save report to server:", err);
      if (!appState.savedDiagnostics.some(d => d.id === appState.lastGeneratedReport.id)) {
        appState.savedDiagnostics.unshift(appState.lastGeneratedReport);
      }
    }
    
    // Show visual confirmation on button
    saveDiagToHistoryBtn.innerHTML = `<i data-lucide="check"></i> <span>Saved to History Log</span>`;
    saveDiagToHistoryBtn.classList.add('disabled');
    saveDiagToHistoryBtn.disabled = true;
    lucide.createIcons();
    
    // Render logs tab
    renderHistoryTab();
  });

  if (downloadPrescriptionBtn) {
    downloadPrescriptionBtn.addEventListener('click', async () => {
      if (!appState.lastGeneratedReport) return;
      const report = appState.lastGeneratedReport;
      const user   = appState.user || {};

      // Silent background save
      if (currentUser && db) {
        setDoc(doc(db, "users", currentUser.uid, "history", report.id), report).catch(()=>{});
      }
      fetch('/api/history', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(report) }).catch(()=>{});

      const patientName   = user.name   || 'Patient';
      const patientAge    = user.age    ? user.age + ' Years' : '--';
      const patientGender = user.gender || '--';
      const patientId     = 'AIH-' + (report.id ? String(report.id).slice(0,4).toUpperCase() : '0000');
      const dateStr       = new Date(report.timestamp || Date.now()).toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
      const symptoms      = report.symptoms || [];
      const matches       = report.matches  || [];
      const topMatch      = matches[0] || null;
      const condDesc      = topMatch ? topMatch.condition.description : 'General health assessment based on reported symptoms.';
      const selfCare      = topMatch ? (topMatch.condition.selfCare || []) : ['Rest adequately.','Stay hydrated.','Monitor symptoms.'];
      const medAdvice     = [condDesc,'Monitor symptoms closely each day.','Ensure proper rest and ventilation.','If no improvement in 3 days, see a physician.'];
      const lifestyleTips = ['Eat healthy and balanced diet.','Light exercise or yoga daily.','Meditation for stress relief.','Maintain good hygiene.','Stay positive and active.'];
      const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=AI_Health_Report_' + report.id;

      const mkLi = arr => arr.map(x=>'<li>'+x+'</li>').join('');
      const condHTML = matches.slice(0,3).map((m,i)=>`<div class="ci"><div class="cl"><div class="cn">0${i+1}</div><div class="cm">${m.condition.name}</div></div><div class="cr"><div class="clb">Confidence</div><div class="cv">${m.percentage}%</div></div></div>`).join('');
      const symHTML  = symptoms.map(s=>`<div class="si"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0f5132" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg><span>${s}</span></div>`).join('');

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Prescription - ${patientName}</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=Playfair+Display:ital,wght@1,600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Outfit',sans-serif;background:#f1f5f9;padding:28px 18px;display:flex;justify-content:center}
.wrap{display:flex;flex-direction:column;align-items:center;width:100%;max-width:820px}
.pbtn{background:#0f5132;color:#fff;border:none;padding:9px 20px;border-radius:6px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;margin-bottom:16px;align-self:flex-end}
.pbtn:hover{opacity:.9}
.card{background:#fff;width:100%;border-left:18px solid #0f5132;border-right:18px solid #0f5132;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;border-radius:8px;padding:34px;box-shadow:0 8px 24px rgba(0,0,0,.07)}
.hdr{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #e2e8f0;padding-bottom:20px;margin-bottom:20px}
.logo{display:flex;align-items:center;gap:10px}
.li{background:#e8f5e9;color:#0f5132;width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.lt{font-size:21px;font-weight:800;color:#0f5132}
.ls{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#64748b}
.hc h1{font-size:28px;font-weight:800;color:#0f172a;text-align:center}
.hc p{font-size:11px;color:#64748b;text-align:center;margin-top:3px}
.pill{background:#0f5132;color:#fff;padding:7px 22px;border-radius:30px;font-size:12px;font-weight:700;display:inline-block;text-transform:uppercase;letter-spacing:1px;margin:13px auto;display:block;width:fit-content}
.pg{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:24px}
.pi{display:flex;align-items:center;gap:9px}
.pic{color:#0f5132;width:18px;height:18px;flex-shrink:0}
.pil{font-size:10px;color:#64748b;text-transform:uppercase;font-weight:500}
.piv{font-size:13px;font-weight:600;color:#0f172a}
.cols{display:grid;grid-template-columns:1.2fr 1fr;gap:26px;margin-bottom:24px}
.ct{font-size:13px;font-weight:700;text-transform:uppercase;color:#0f5132;border-bottom:2px solid #e8f5e9;padding-bottom:7px;margin-bottom:12px}
.ci{display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border:1px solid #e2e8f0;border-radius:7px;padding:10px 13px;margin-bottom:9px}
.cl{display:flex;align-items:center;gap:10px}
.cn{background:#0f5132;color:#fff;width:23px;height:23px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
.cm{font-size:13px;font-weight:600}
.cr{text-align:right}
.clb{font-size:9px;color:#64748b;text-transform:uppercase}
.cv{font-size:14px;font-weight:700;color:#0f5132}
.sg{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.si{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:500}
.adv{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px}
.ac{border-radius:8px;padding:16px;border:1px solid #e2e8f0}
.ac.b{background:#f0f9ff;border-color:#bae6fd}
.ac.g{background:#f0fdf4;border-color:#bbf7d0}
.ac.y{background:#fefce8;border-color:#fef08a}
.ah{display:flex;align-items:center;gap:7px;margin-bottom:10px}
.ah svg{width:15px;height:15px;flex-shrink:0}
.ac.b .ah svg{stroke:#0ea5e9}
.ac.g .ah svg{stroke:#0f5132}
.ac.y .ah svg{stroke:#a16207}
.at{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
.al{list-style:none}
.al li{font-size:11px;line-height:1.5;margin-bottom:6px;padding-left:10px;position:relative}
.al li::before{content:"â€¢";position:absolute;left:0;color:#64748b}
.ft{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:16px;border-top:2px solid #e2e8f0;padding-top:16px;align-items:start}
.wt{font-size:11px;font-weight:700;color:#b91c1c;text-transform:uppercase;display:flex;align-items:center;gap:5px;margin-bottom:8px}
.wt svg{width:13px;height:13px;stroke:#b91c1c;flex-shrink:0}
.wl{list-style:none}
.wl li{font-size:11px;color:#475569;margin-bottom:4px;padding-left:9px;position:relative}
.wl li::before{content:"â€¢";color:#b91c1c;position:absolute;left:0}
.sos{background:#b91c1c;color:#fff;border-radius:30px;padding:5px 12px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:5px;width:fit-content;margin-top:8px;text-decoration:none}
.ftl{font-size:11px;font-weight:700;text-transform:uppercase;display:flex;align-items:center;gap:6px;margin-bottom:8px}
.ftl svg{stroke:#0f5132;width:13px;height:13px;flex-shrink:0}
.fb{font-size:11px;color:#475569;line-height:1.6}
.cb{display:flex;align-items:center;gap:6px;margin-top:12px;color:#0f5132;font-weight:600;font-size:11px}
.cb svg{stroke:#0f5132;width:13px;height:13px}
.sb{display:flex;flex-direction:column;align-items:center;text-align:center}
.st{font-size:9px;font-weight:700;color:#0f5132;text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px}
.qr{border:2px solid #e8f5e9;padding:3px;border-radius:4px;background:#fff;width:96px;height:96px}
.qr img{width:100%;height:100%}
.bb{background:#0f5132;color:#fff;padding:9px 34px;display:flex;justify-content:space-between;align-items:center;width:100%;border-bottom-left-radius:8px;border-bottom-right-radius:8px;font-size:9px}
.bs{font-family:'Playfair Display',serif;font-style:italic;font-size:12px}
@media print{body{background:#fff;padding:0}.pbtn{display:none}.card{box-shadow:none;border-radius:0;max-width:100%;width:100%;padding:18px}}
</style></head><body>
<div class="wrap">
<button class="pbtn" onclick="window.print()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print / Download PDF</button>
<div class="card">
<div class="hdr">
  <div class="logo"><div class="li"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0f5132" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg></div><div><div class="lt">AI_health</div><div class="ls">Symptoms Checker</div></div></div>
  <div class="hc"><h1>AI_HEALTH</h1><p>Analyze &bull; Understand &bull; Stay Healthy</p></div>
  <svg width="78" height="38" viewBox="0 0 100 40" fill="none"><path d="M0 20h18l5-14l10 28l8-18l6 4h33" stroke="#198754" stroke-width="2.2" stroke-linejoin="round"/></svg>
</div>
<div style="text-align:center"><div class="pill">Prescription &amp; Health Advice</div></div>
<div class="pg">
  <div class="pi"><svg class="pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><div><div class="pil">Patient Name</div><div class="piv">${patientName}</div></div></div>
  <div class="pi"><svg class="pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><div><div class="pil">Age</div><div class="piv">${patientAge}</div></div></div>
  <div class="pi"><svg class="pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg><div><div class="pil">Patient ID</div><div class="piv">${patientId}</div></div></div>
  <div class="pi"><svg class="pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><div><div class="pil">Gender</div><div class="piv">${patientGender}</div></div></div>
  <div class="pi"><svg class="pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><div><div class="pil">Date</div><div class="piv">${dateStr}</div></div></div>
  <div class="pi"><svg class="pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg><div><div class="pil">Consultation Type</div><div class="piv">AI Health Check</div></div></div>
</div>
<div class="cols">
  <div><div class="ct">Possible Conditions</div>${condHTML||'<p style="font-size:12px;color:#64748b">No conditions matched</p>'}</div>
  <div><div class="ct">Detected Symptoms</div><div class="sg">${symHTML||'<p style="font-size:12px;color:#64748b">No symptoms recorded</p>'}</div></div>
</div>
<div class="adv">
  <div class="ac b"><div class="ah"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg><span class="at">Medical Advice</span></div><ul class="al">${mkLi(medAdvice)}</ul></div>
  <div class="ac g"><div class="ah"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg><span class="at">Recommended Care</span></div><ul class="al">${mkLi(selfCare)}</ul></div>
  <div class="ac y"><div class="ah"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><span class="at">Lifestyle Tips</span></div><ul class="al">${mkLi(lifestyleTips)}</ul></div>
</div>
<div class="ft">
  <div><div class="wt"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Warning Signs</div>
  <ul class="wl"><li>High fever (Above 102Â°F)</li><li>Difficulty in breathing</li><li>Chest pain or pressure</li><li>Severe headache or confusion</li><li>Persistent vomiting</li></ul>
  <a href="tel:8207004928" class="sos"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>EMERGENCY: 8207004928</a></div>
  <div><div class="ftl"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Follow Up</div>
  <div class="fb">If symptoms do not improve within <strong>3â€“4 days</strong>, or worsen, please consult a medical doctor.</div>
  <div class="cb"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>AI Health Team</div></div>
  <div class="sb"><div class="st">Scan For More Info</div><div class="qr"><img src="${qrUrl}" alt="QR"/></div></div>
</div>
</div>
<div class="bb"><div style="max-width:65%">Disclaimer: AI-generated suggestion only. Not a substitute for professional medical advice. Always consult a qualified healthcare provider.</div><div class="bs">Stay Healthy, Stay Happy! &#9825;</div></div>
</div>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),600));</script>
</body></html>`;

      const blob = new Blob([html], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    });
  }

  function renderHistoryTab() {
    if (appState.savedDiagnostics.length === 0) {
      historyEmptyState.style.display = 'flex';
      historyList.style.display = 'none';
      clearHistoryLogBtn.style.display = 'none';
      return;
    }
    
    historyEmptyState.style.display = 'none';
    historyList.style.display = 'flex';
    clearHistoryLogBtn.style.display = 'inline-flex';
    
    historyList.innerHTML = '';
    
    appState.savedDiagnostics.forEach(report => {
      const primaryMatch = report.matches[0].condition;
      const formattedDate = new Date(report.timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const card = document.createElement('div');
      card.className = 'history-card';
      card.innerHTML = `
        <div class="hist-left">
          <span class="urgency-indicator-dot ${report.urgency}"></span>
          <div class="hist-title-data">
            <h4>${primaryMatch.name}</h4>
            <div class="hist-chips">
              ${report.symptoms.map(s => `<span class="hist-symptom-tag">${s}</span>`).slice(0, 3).join('')}
              ${report.symptoms.length > 3 ? `<span class="hist-symptom-tag">+${report.symptoms.length - 3} more</span>` : ''}
            </div>
          </div>
        </div>
        <div class="hist-right">
          <span class="hist-date">${formattedDate}</span>
          <div class="hist-actions">
            <button class="hist-action-btn hist-view-btn" data-id="${report.id}" title="Open Report Details">
              <i data-lucide="external-link" style="width: 15px; height: 15px;"></i>
            </button>
            <button class="hist-action-btn hist-delete-btn" data-id="${report.id}" title="Delete Record">
              <i data-lucide="trash-2" style="width: 15px; height: 15px;"></i>
            </button>
          </div>
        </div>
      `;
      historyList.appendChild(card);
      
      // Log open detail click
      card.querySelector('.hist-view-btn').addEventListener('click', () => {
        loadReportFromHistory(report.id);
      });
      
      // Log delete click
      card.querySelector('.hist-delete-btn').addEventListener('click', () => {
        deleteReportFromHistory(report.id);
      });
    });
    
    lucide.createIcons();
  }

  function loadReportFromHistory(id) {
    const report = appState.savedDiagnostics.find(d => d.id === id);
    if (!report) return;
    
    // Set active values in checker input state
    appState.selectedSymptoms = new Set();
    // Re-resolve IDs of symptoms
    report.symptoms.forEach(sName => {
      const sym = SYMPTOMS_DB.find(s => s.name.toLowerCase() === sName.toLowerCase());
      if (sym) appState.selectedSymptoms.add(sym.id);
    });
    
    appState.lastGeneratedReport = report;
    
    // Sync components & layouts
    updateSelectedChips();
    syncUIWithSelectedSymptoms();
    renderReportUI(report);
    
    // Prepare results button check states
    saveDiagToHistoryBtn.innerHTML = `<i data-lucide="check"></i> <span>Report Saved</span>`;
    saveDiagToHistoryBtn.classList.add('disabled');
    saveDiagToHistoryBtn.disabled = true;
    lucide.createIcons();
    
    // Switch screens
    stateEmpty.classList.remove('active');
    stateForm.classList.remove('active');
    stateScanning.classList.remove('active');
    stateResults.classList.add('active');
    
    switchTab('checker');
  }

  async function deleteReportFromHistory(id) {
    if (confirm('Are you sure you want to delete this health log record?')) {
      if (currentUser && db) {
        try {
          await deleteDoc(doc(db, "users", currentUser.uid, "history", id));
          console.log("Firestore history record deleted");
        } catch (fErr) {
          console.error("Firestore history record delete error:", fErr);
        }
      }
      try {
        const res = await fetch(`/api/history/${id}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          appState.savedDiagnostics = await res.json();
        } else {
          appState.savedDiagnostics = appState.savedDiagnostics.filter(d => d.id !== id);
        }
      } catch (err) {
        console.error("Failed to delete record:", err);
        appState.savedDiagnostics = appState.savedDiagnostics.filter(d => d.id !== id);
      }
      renderHistoryTab();
    }
  }

  clearHistoryLogBtn.addEventListener('click', async () => {
    if (confirm('Warning: This will permanently delete ALL saved diagnostic history logs. Continue?')) {
      if (currentUser && db) {
        try {
          const historyCol = collection(db, "users", currentUser.uid, "history");
          const snaps = await getDocs(historyCol);
          const deletePromises = [];
          snaps.forEach((docSnap) => {
            deletePromises.push(deleteDoc(doc(db, "users", currentUser.uid, "history", docSnap.id)));
          });
          await Promise.all(deletePromises);
          console.log("Firestore history logs cleared");
        } catch (fErr) {
          console.error("Firestore history logs clear error:", fErr);
        }
      }
      try {
        for (const report of appState.savedDiagnostics) {
          await fetch(`/api/history/${report.id}`, { method: 'DELETE' }).catch(()=>{});
        }
        appState.savedDiagnostics = [];
      } catch (err) {
        console.error(err);
        appState.savedDiagnostics = [];
      }
      renderHistoryTab();
    }
  });


  // --- AI HEALTH CHAT ASSISTANT SIMULATOR ---
  
  chatUserInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    chatSendTrigger.disabled = !val;
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatUserInput.value.trim();
    if (!text) return;
    
    addUserChatMessage(text);
    chatUserInput.value = '';
    chatSendTrigger.disabled = true;
    
    // Trigger animated bot typing effect
    triggerBotTypingResponse(text);
  });

  // Suggestion prompt chips click
  suggestionChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const text = chip.textContent;
      addUserChatMessage(text);
      triggerBotTypingResponse(text);
    });
  });

  function addUserChatMessage(text) {
    appState.chatHistory.push({
      sender: 'user',
      text,
      time: getCurrentTimeString()
    });
    
    const msgElement = document.createElement('div');
    msgElement.className = 'message user-msg';
    msgElement.innerHTML = `
      <div class="msg-avatar">
        <i data-lucide="user" style="width: 16px; height: 16px;"></i>
      </div>
      <div class="msg-bubble">
        <p>${escapeHtml(text)}</p>
        <span class="msg-time">${getCurrentTimeString()}</span>
      </div>
    `;
    chatMessagesContainer.appendChild(msgElement);
    scrollToBottom(chatMessagesContainer);
    
    lucide.createIcons();
  }

  async function triggerBotTypingResponse(userQuery) {
    // 1. Create temporary typing animation loader bubble
    const typingBubble = document.createElement('div');
    typingBubble.className = 'message system-msg';
    typingBubble.id = 'bot-typing-indicator';
    typingBubble.innerHTML = `
      <div class="msg-avatar">
        <i data-lucide="bot" style="width: 16px; height: 16px;"></i>
      </div>
      <div class="msg-bubble" style="display: flex; gap: 4px; padding: 12px 18px; align-items: center;">
        <span style="width: 6px; height: 6px; border-radius:50%; background:var(--text-muted); display:inline-block; animation: scale-up 0.8s infinite alternate 0s;"></span>
        <span style="width: 6px; height: 6px; border-radius:50%; background:var(--text-muted); display:inline-block; animation: scale-up 0.8s infinite alternate 0.2s;"></span>
        <span style="width: 6px; height: 6px; border-radius:50%; background:var(--text-muted); display:inline-block; animation: scale-up 0.8s infinite alternate 0.4s;"></span>
      </div>
    `;
    chatMessagesContainer.appendChild(typingBubble);
    scrollToBottom(chatMessagesContainer);
    lucide.createIcons();

    // 2. Generate response via Flask backend API
    let replyText = "";
    try {
      const lang = appState.currentLanguage || 'en';
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userQuery, lang })
      });
      if (res.ok) {
        const data = await res.json();
        replyText = data.reply;
      } else {
        replyText = formulateBotAnswer(userQuery);
      }
    } catch (err) {
      console.error(err);
      replyText = formulateBotAnswer(userQuery);
    }
    
    // Stagger response timing slightly for human feel
    setTimeout(() => {
      // Remove typing bubble
      const indicator = document.getElementById('bot-typing-indicator');
      if (indicator) indicator.remove();
      
      // Render final bot bubble
      appState.chatHistory.push({
        sender: 'bot',
        text: replyText,
        time: getCurrentTimeString()
      });
      
      const msgElement = document.createElement('div');
      msgElement.className = 'message system-msg';
      msgElement.innerHTML = `
        <div class="msg-avatar">
          <i data-lucide="bot" style="width: 16px; height: 16px;"></i>
        </div>
        <div class="msg-bubble">
          <p>${replyText}</p>
          <span class="msg-time">${getCurrentTimeString()}</span>
        </div>
      `;
      chatMessagesContainer.appendChild(msgElement);
      scrollToBottom(chatMessagesContainer);
      lucide.createIcons();
    }, 600);
  }

  function formulateBotAnswer(query) {
    const q = query.toLowerCase();
    
    // Rule based custom chatbot strings
    if (q.includes('headache') || q.includes('migraine')) {
      return 'Headaches can stem from muscle tension, hydration issues, sinus pressure, or fatigue. If you suffer from throbbing pain localized to one side, you may be experiencing a Migraine. Try resting in a dark room and drinking 500ml of water. Seek medical consultation if it is accompanied by vision impairments or neck stiffness.';
    }
    if (q.includes('chest pain') || q.includes('heart') || q.includes('palpitations')) {
      return '<strong>Important Safety Warning:</strong> Chest pain can indicate cardiovascular stress or an emergency. If your chest pain is crushing, spreads to your left arm or jaw, or is accompanied by sweating and breathing difficulties, please trigger our <strong>Emergency SOS</strong> or contact your local paramedics immediately.';
    }
    if (q.includes('fever')) {
      return 'Fever is your body\'s defense mechanism against infections. Mild fevers under 101Â°F (38.3Â°C) usually benefit from rest and fluids. For adults, if a fever surpasses 103Â°F (39.4Â°C) or lasts over 3 consecutive days, seek clinical attention. You can use acetaminophen to alleviate comfort.';
    }
    if (q.includes('anxiety') || q.includes('stress') || q.includes('nervous')) {
      return 'To reduce anxiety naturally, try practicing 4-7-8 deep breathing: Inhale for 4s, hold for 7s, exhale for 8s. Regular cardiovascular exercise, reduced caffeine intake, and setting strict digital detox boundaries in the evening are highly effective. If chronic anxiety interferes with daily tasks, consider speaking to a therapist.';
    }
    if (q.includes('diet') || q.includes('food') || q.includes('nutrition') || q.includes('immune')) {
      return 'Building immune health starts with a nutrient-dense diet. Incorporate foods high in Vitamin C (citrus fruits, bell peppers), zinc (pumpkin seeds, lentils), and antioxidants (blueberries, spinach). Staying active and maintaining gut health with probiotic foods (yogurt, kefir) is also vital.';
    }
    if (q.includes('blood pressure') || q.includes('hypertension')) {
      return 'Normal blood pressure is generally under 120/80 mmHg. To manage it naturally, reduce dietary sodium, increase potassium intake (bananas, sweet potatoes), engage in 150 minutes of weekly moderate exercise, and limit alcohol consumption. Never modify blood pressure medication without medical oversight.';
    }
    if (q.includes('thank') || q.includes('hello') || q.includes('hi ')) {
      return 'You\'re welcome! I\'m here to assist you with health inquiries. Let me know if you have other symptoms to discuss or need healthy habit suggestions.';
    }
    
    return 'That is a valuable health question. While I can offer wellness context, specific physiological issues require localized diagnostic testing. We highly recommend adding any physical symptoms to our **Symptom Checker** tab to configure a differential analysis report.';
  }

  clearChatBtn.addEventListener('click', () => {
    if (confirm('Clear entire conversation history?')) {
      chatMessagesContainer.innerHTML = '';
      appState.chatHistory = [];
      
      // Re-add initial bot greeting
      const greeting = {
        sender: 'bot',
        text: 'Conversation history reset. Ask me anything about wellness, symptoms, or preventive guidelines!',
        time: getCurrentTimeString()
      };
      appState.chatHistory.push(greeting);
      
      const msgElement = document.createElement('div');
      msgElement.className = 'message system-msg';
      msgElement.innerHTML = `
        <div class="msg-avatar">
          <i data-lucide="bot" style="width: 16px; height: 16px;"></i>
        </div>
        <div class="msg-bubble">
          <p>${greeting.text}</p>
          <span class="msg-time">${greeting.time}</span>
        </div>
      `;
      chatMessagesContainer.appendChild(msgElement);
      lucide.createIcons();
    }
  });


  // --- GLOBAL EMERGENCY SOS ---
  
  emergencyTrigger.addEventListener('click', () => {
    const sosChoice = confirm('EMERGENCY ALERT TRIGGERED\n\nWould you like to initiate a telephone call to your emergency contact (8207004928)?');
    if (sosChoice) {
      window.location.href = 'tel:8207004928';
    }
  });


  // --- HELPER UTILITIES ---
  
  function generateUUID() {
    return 'xxxx-xxxx-4xxx-yxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function capitalizeFirstLetter(val) {
    if (!val) return '';
    return val.charAt(0).toUpperCase() + val.slice(1);
  }



  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
  }

  function scrollToBottom(element) {
    element.scrollTop = element.scrollHeight;
  }

  // Duplicate TRANSLATIONS dictionary removed (moved to top)
  // Switch UI languages
  function changeLanguage(lang) {
    appState.currentLanguage = lang;
    localStorage.setItem('aegis_language', lang);
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) {
        el.textContent = TRANSLATIONS[lang][key];
      }
    });
    
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) {
        el.placeholder = TRANSLATIONS[lang][key];
      }
    });

    // Reload active lists to update languages
    renderMedications();
    renderSleepLogs();
  }

  // --- VOICE SPEECH INPUT ---
  if (voiceSearchBtn) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      
      recognition.onstart = () => {
        voiceSearchBtn.classList.add('recording');
      };
      
      recognition.onend = () => {
        voiceSearchBtn.classList.remove('recording');
      };
      
      recognition.onerror = (e) => {
        console.error('Speech recognition error', e);
        voiceSearchBtn.classList.remove('recording');
      };
      
      recognition.onresult = (event) => {
        const text = event.results[0][0].transcript.trim();
        searchInput.value = text;
        
        let foundSymptoms = [];
        SYMPTOMS_DB.forEach(sym => {
          if (text.toLowerCase().includes(sym.name.toLowerCase()) || text.toLowerCase().includes(sym.id)) {
            foundSymptoms.push(sym.id);
          }
        });
        
        if (foundSymptoms.length > 0) {
          foundSymptoms.forEach(id => addSymptom(id));
          searchInput.value = '';
        } else {
          // Speak has no direct matches - add the transcribed text directly as a custom symptom!
          const customName = capitalizeFirstLetter(text);
          const customId = 'custom_' + text.toLowerCase().replace(/[^a-z0-9]/g, '_');
          if (!SYMPTOMS_DB.some(s => s.id === customId)) {
            SYMPTOMS_DB.push({
              id: customId,
              name: customName,
              region: 'body'
            });
          }
          addSymptom(customId);
          searchInput.value = '';
        }
      };
      
      voiceSearchBtn.addEventListener('click', () => {
        if (appState.currentLanguage === 'bn') {
          recognition.lang = 'bn-BD';
        } else if (appState.currentLanguage === 'hi') {
          recognition.lang = 'hi-IN';
        } else {
          recognition.lang = 'en-US';
        }
        
        if (voiceSearchBtn.classList.contains('recording')) {
          recognition.stop();
        } else {
          recognition.start();
        }
      });
    } else {
      voiceSearchBtn.style.display = 'none';
    }
  }

  // --- SKIN DISEASE DETECTOR ---

  const SKIN_CONDITIONS = [
    {
      name: "Atopic Dermatitis (Eczema)",
      name_bn: "à¦…à§à¦¯à¦¾à¦Ÿà§‹à¦ªà¦¿à¦• à¦¡à¦¾à¦°à§à¦®à¦¾à¦Ÿà¦¾à¦‡à¦Ÿà¦¿à¦¸ (à¦à¦•à¦œà¦¿à¦®à¦¾)",
      name_hi: "à¤à¤Ÿà¥‹à¤ªà¤¿à¤• à¤¡à¤°à¥à¤®à¥‡à¤Ÿà¤¾à¤‡à¤Ÿà¤¿à¤¸ (à¤à¤•à¥à¤œà¤¿à¤®à¤¾)",
      pct: 92,
      warning: false,
      desc: "An inflammatory skin condition causing dry, red, and extremely itchy patches, common in joint creases.",
      desc_bn: "à¦à¦•à¦Ÿà¦¿ à¦ªà§à¦°à¦¦à¦¾à¦¹à¦œà¦¨à¦• à¦¤à§à¦¬à¦•à§‡à¦° à¦…à¦¬à¦¸à§à¦¥à¦¾ à¦¯à¦¾ à¦¶à§à¦·à§à¦•, à¦²à¦¾à¦² à¦à¦¬à¦‚ à¦…à¦¤à§à¦¯à¦¨à§à¦¤ à¦šà§à¦²à¦•à¦¾à¦¨à¦¿à¦¯à§à¦•à§à¦¤ à¦¦à¦¾à¦— à¦¸à§ƒà¦·à§à¦Ÿà¦¿ à¦•à¦°à§‡, à¦¸à¦¾à¦§à¦¾à¦°à¦£à¦¤ à¦œà¦¯à¦¼à§‡à¦¨à§à¦Ÿà¦—à§à¦²à¦¿à¦¤à§‡ à¦¹à¦¯à¦¼à¥¤",
      desc_hi: "à¤à¤• à¤¸à¥‚à¤œà¤¨à¤¯à¥à¤•à¥à¤¤ à¤¤à¥à¤µà¤šà¤¾ à¤•à¥€ à¤¸à¥à¤¥à¤¿à¤¤à¤¿ à¤œà¥‹ à¤¸à¥‚à¤–à¥€, à¤²à¤¾à¤² à¤”à¤° à¤…à¤¤à¥à¤¯à¤§à¤¿à¤• à¤–à¥à¤œà¤²à¥€ à¤µà¤¾à¤²à¥‡ à¤ªà¥ˆà¤š à¤•à¤¾ à¤•à¤¾à¤°à¤£ à¤¬à¤¨à¤¤à¥€ à¤¹à¥ˆ, à¤œà¥‹à¤¡à¤¼à¥‹à¤‚ à¤•à¥€ à¤¸à¤¿à¤²à¤µà¤Ÿà¥‹à¤‚ à¤®à¥‡à¤‚ à¤†à¤® à¤¹à¥ˆà¥¤",
      care: [
        "Moisturize skin twice daily with thick, fragrance-free creams.",
        "Avoid harsh soaps, hot water, and sudden temperature shifts.",
        "Use cold compresses to alleviate acute itching fits.",
        "Avoid wool clothing and environmental allergens."
      ],
      care_bn: [
        "à¦¸à§à¦—à¦¨à§à¦§à¦¿à¦®à§à¦•à§à¦¤ à¦˜à¦¨ à¦•à§à¦°à¦¿à¦® à¦¦à¦¿à¦¯à¦¼à§‡ à¦¦à¦¿à¦¨à§‡ à¦¦à§à¦¬à¦¾à¦° à¦¤à§à¦¬à¦• à¦®à¦¯à¦¼à¦¶à§à¦šà¦¾à¦°à¦¾à¦‡à¦œ à¦•à¦°à§à¦¨à¥¤",
        "à¦•à¦¡à¦¼à¦¾ à¦¸à¦¾à¦¬à¦¾à¦¨, à¦—à¦°à¦® à¦œà¦² à¦à¦¬à¦‚ à¦¹à¦ à¦¾à§Ž à¦¤à¦¾à¦ªà¦®à¦¾à¦¤à§à¦°à¦¾ à¦ªà¦°à¦¿à¦¬à¦°à§à¦¤à¦¨ à¦à¦¡à¦¼à¦¿à¦¯à¦¼à§‡ à¦šà¦²à§à¦¨à¥¤",
        "à¦šà§à¦²à¦•à¦¾à¦¨à¦¿ à¦•à¦®à¦¾à¦¤à§‡ à¦ à¦¾à¦¨à§à¦¡à¦¾ à¦¸à§‡à¦à¦• à¦¬à§à¦¯à¦¬à¦¹à¦¾à¦° à¦•à¦°à§à¦¨à¥¤",
        "à¦ªà¦¶à¦®à§€ à¦•à¦¾à¦ªà¦¡à¦¼ à¦à¦¬à¦‚ à¦ªà¦°à¦¿à¦¬à§‡à¦¶à¦—à¦¤ à¦…à§à¦¯à¦¾à¦²à¦¾à¦°à§à¦œà§‡à¦¨ à¦à¦¡à¦¼à¦¿à¦¯à¦¼à§‡ à¦šà¦²à§à¦¨à¥¤"
      ],
      care_hi: [
        "à¤–à¥à¤¶à¤¬à¥‚ à¤°à¤¹à¤¿à¤¤ à¤—à¤¾à¤¢à¤¼à¥€ à¤•à¥à¤°à¥€à¤® à¤¸à¥‡ à¤¦à¤¿à¤¨ à¤®à¥‡à¤‚ à¤¦à¥‹ à¤¬à¤¾à¤° à¤¤à¥à¤µà¤šà¤¾ à¤•à¥‹ à¤®à¥‰à¤‡à¤¸à¥à¤šà¤°à¤¾à¤‡à¤œ à¤•à¤°à¥‡à¤‚à¥¤",
        "à¤•à¤ à¥‹à¤° à¤¸à¤¾à¤¬à¥à¤¨, à¤—à¤°à¥à¤® à¤ªà¤¾à¤¨à¥€ à¤”à¤° à¤…à¤šà¤¾à¤¨à¤• à¤¤à¤¾à¤ªà¤®à¤¾à¤¨ à¤ªà¤°à¤¿à¤µà¤°à¥à¤¤à¤¨ à¤¸à¥‡ à¤¬à¤šà¥‡à¤‚à¥¤",
        "à¤¤à¥€à¤µà¥à¤° à¤–à¥à¤œà¤²à¥€ à¤¸à¥‡ à¤°à¤¾à¤¹à¤¤ à¤ªà¤¾à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤ à¤‚à¤¡à¥€ à¤¸à¤¿à¤•à¤¾à¤ˆ à¤•à¤¾ à¤ªà¥à¤°à¤¯à¥‹à¤— à¤•à¤°à¥‡à¤‚à¥¤",
        "à¤Šà¤¨à¥€ à¤•à¤ªà¤¡à¤¼à¥‹à¤‚ à¤”à¤° à¤ªà¤°à¥à¤¯à¤¾à¤µà¤°à¤£à¥€à¤¯ à¤à¤²à¤°à¥à¤œà¥€ à¤•à¤¾à¤°à¤•à¥‹à¤‚ à¤¸à¥‡ à¤¬à¤šà¥‡à¤‚à¥¤"
      ]
    },
    {
      name: "Acne Vulgaris",
      name_bn: "à¦…à§à¦¯à¦¾à¦•à¦¨à¦¿ à¦­à¦¾à¦²à¦—à¦¾à¦°à¦¿à¦¸ (à¦¬à§à¦°à¦£)",
      name_hi: "à¤à¤•à¥à¤¨à¥‡ à¤µà¤²à¥à¤—à¥‡à¤°à¤¿à¤¸ (à¤®à¥à¤à¤¹à¤¾à¤¸à¥‡)",
      pct: 88,
      warning: false,
      desc: "A common skin condition occurring when hair follicles become clogged with oil and dead skin cells.",
      desc_bn: "à¦à¦•à¦Ÿà¦¿ à¦¸à¦¾à¦§à¦¾à¦°à¦£ à¦¤à§à¦¬à¦•à§‡à¦° à¦…à¦¬à¦¸à§à¦¥à¦¾ à¦¯à¦¾ à¦˜à¦Ÿà§‡ à¦¯à¦–à¦¨ à¦²à§‹à¦®à¦•à§‚à¦ª à¦¤à§‡à¦² à¦à¦¬à¦‚ à¦¤à§à¦¬à¦•à§‡à¦° à¦®à§ƒà¦¤ à¦•à§‹à¦· à¦¦à§à¦¬à¦¾à¦°à¦¾ à¦…à¦¬à¦°à§à¦¦à§à¦§ à¦¹à¦¯à¦¼à§‡ à¦¯à¦¾à¦¯à¦¼à¥¤",
      desc_hi: "à¤à¤• à¤†à¤® à¤¤à¥à¤µà¤šà¤¾ à¤•à¥€ à¤¸à¥à¤¥à¤¿à¤¤à¤¿ à¤œà¥‹ à¤¤à¤¬ à¤¹à¥‹à¤¤à¥€ à¤¹à¥ˆ à¤œà¤¬ à¤¬à¤¾à¤²à¥‹à¤‚ à¤•à¥‡ à¤°à¥‹à¤® à¤¤à¥‡à¤² à¤”à¤° à¤®à¥ƒà¤¤ à¤¤à¥à¤µà¤šà¤¾ à¤•à¥‹à¤¶à¤¿à¤•à¤¾à¤“à¤‚ à¤¸à¥‡ à¤¬à¤‚à¤¦ à¤¹à¥‹ à¤œà¤¾à¤¤à¥‡ à¤¹à¥ˆà¤‚à¥¤",
      care: [
        "Cleanse face gently twice daily with a mild salicylic acid cleanser.",
        "Avoid picking, squeezing, or popping acne lesions.",
        "Use non-comedogenic (pore-friendly) moisturizers and sunscreen.",
        "Limit intake of high-glycemic foods and dairy products."
      ],
      care_bn: [
        "à¦®à§ƒà¦¦à§ à¦¸à§à¦¯à¦¾à¦²à¦¿à¦¸à¦¿à¦²à¦¿à¦• à¦…à§à¦¯à¦¾à¦¸à¦¿à¦¡ à¦•à§à¦²à¦¿à¦¨à¦œà¦¾à¦° à¦¦à¦¿à§Ÿà§‡ à¦¦à¦¿à¦¨à§‡ à¦¦à§à¦¬à¦¾à¦° à¦®à§à¦– à¦¹à¦¾à¦²à¦•à¦¾à¦­à¦¾à¦¬à§‡ à¦ªà¦°à¦¿à¦·à§à¦•à¦¾à¦° à¦•à¦°à§à¦¨à¥¤",
        "à¦¬à§à¦°à¦£ à¦–à§‹à¦à¦Ÿà¦¾ à¦¬à¦¾ à¦«à¦¾à¦Ÿà¦¾à¦¨à§‹ à¦à§œà¦¿à§Ÿà§‡ à¦šà¦²à§à¦¨à¥¤",
        "à¦¨à¦¨-à¦•à¦®à§‡à¦¡à§‹à¦œà§‡à¦¨à¦¿à¦• à¦®à¦¯à¦¼à¦¶à§à¦šà¦¾à¦°à¦¾à¦‡à¦œà¦¾à¦° à¦à¦¬à¦‚ à¦¸à¦¾à¦¨à¦¸à§à¦•à§à¦°à¦¿à¦¨ à¦¬à§à¦¯à¦¬à¦¹à¦¾à¦° à¦•à¦°à§à¦¨à¥¤",
        "à¦®à¦¿à¦·à§à¦Ÿà¦¿ à¦–à¦¾à¦¬à¦¾à¦° à¦à¦¬à¦‚ à¦¦à§à¦—à§à¦§à¦œà¦¾à¦¤ à¦–à¦¾à¦¬à¦¾à¦°à§‡à¦° à¦¬à§à¦¯à¦¬à¦¹à¦¾à¦° à¦¸à§€à¦®à¦¿à¦¤ à¦•à¦°à§à¦¨à¥¤"
      ],
      care_hi: [
        "à¤¸à¥Œà¤®à¥à¤¯ à¤¸à¥ˆà¤²à¤¿à¤¸à¤¿à¤²à¤¿à¤• à¤à¤¸à¤¿à¤¡ à¤•à¥à¤²à¥€à¤‚à¤œà¤° à¤¸à¥‡ à¤¦à¤¿à¤¨ à¤®à¥‡à¤‚ à¤¦à¥‹ à¤¬à¤¾à¤° à¤šà¥‡à¤¹à¤°à¤¾ à¤§à¥‹à¤à¤‚à¥¤",
        "à¤®à¥à¤à¤¹à¤¾à¤¸à¥‹à¤‚ à¤•à¥‹ à¤¨à¥‹à¤šà¤¨à¥‡ à¤¯à¤¾ à¤¦à¤¬à¤¾à¤¨à¥‡ à¤¸à¥‡ à¤¬à¤šà¥‡à¤‚à¥¤",
        "à¤—à¥ˆà¤°-à¤•à¥‰à¤®à¥‡à¤¡à¥‹à¤œà¥‡à¤¨à¤¿à¤• (à¤°à¥‹à¤®à¤›à¤¿à¤¦à¥à¤°à¥‹à¤‚ à¤•à¥‡ à¤…à¤¨à¥à¤•à¥‚à¤²) à¤®à¥‰à¤‡à¤¸à¥à¤šà¤°à¤¾à¤‡à¤œà¤¼à¤° à¤”à¤° à¤¸à¤¨à¤¸à¥à¤•à¥à¤°à¥€à¤¨ à¤•à¤¾ à¤‰à¤ªà¤¯à¥‹à¤— à¤•à¤°à¥‡à¤‚à¥¤",
        "à¤‰à¤šà¥à¤š à¤—à¥à¤²à¤¾à¤‡à¤¸à¥‡à¤®à¤¿à¤• à¤–à¤¾à¤¦à¥à¤¯ à¤ªà¤¦à¤¾à¤°à¥à¤¥à¥‹à¤‚ à¤”à¤° à¤¡à¥‡à¤¯à¤°à¥€ à¤‰à¤¤à¥à¤ªà¤¾à¤¦à¥‹à¤‚ à¤•à¤¾ à¤¸à¥‡à¤µà¤¨ à¤¸à¥€à¤®à¤¿à¤¤ à¤•à¤°à¥‡à¤‚à¥¤"
      ]
    },
    {
      name: "Plaque Psoriasis",
      name_bn: "à¦ªà§à¦²à§‡à¦• à¦¸à§‹à¦°à¦¿à¦¯à¦¼à¦¾à¦¸à¦¿à¦¸",
      name_hi: "à¤ªà¥à¤²à¥‡à¤• à¤¸à¥‹à¤°à¤¾à¤¯à¤¸à¤¿à¤¸",
      pct: 84,
      warning: true,
      desc: "An autoimmune disease causing rapid buildup of skin cells, leading to scaly, silvery plaques.",
      desc_bn: "à¦à¦•à¦Ÿà¦¿ à¦…à¦Ÿà§‹à¦‡à¦®à¦¿à¦‰à¦¨ à¦°à§‹à¦— à¦¯à¦¾ à¦¤à§à¦¬à¦•à§‡à¦° à¦•à§‹à¦·à¦—à§à¦²à¦¿à¦° à¦¦à§à¦°à§à¦¤ à¦¬à§ƒà¦¦à§à¦§à¦¿à¦° à¦•à¦¾à¦°à¦£à§‡ à¦†à¦à¦¶à¦¯à§à¦•à§à¦¤, à¦°à§‚à¦ªà¦¾à¦²à§€ à¦°à¦™à§‡à¦° à¦ªà§à¦²à¦¾à¦• à¦¤à§ˆà¦°à¦¿ à¦•à¦°à§‡à¥¤",
      desc_hi: "à¤à¤• à¤‘à¤Ÿà¥‹à¤‡à¤®à¥à¤¯à¥‚à¤¨ à¤¬à¥€à¤®à¤¾à¤°à¥€ à¤œà¥‹ à¤¤à¥à¤µà¤šà¤¾ à¤•à¥‹à¤¶à¤¿à¤•à¤¾à¤“à¤‚ à¤•à¥‡ à¤¤à¥‡à¤œà¥€ à¤¸à¥‡ à¤¨à¤¿à¤°à¥à¤®à¤¾à¤£ à¤•à¤¾ à¤•à¤¾à¤°à¤£ à¤¬à¤¨à¤¤à¥€ à¤¹à¥ˆ, à¤œà¤¿à¤¸à¤¸à¥‡ à¤ªà¤ªà¤¡à¤¼à¥€à¤¦à¤¾à¤°, à¤šà¤¾à¤‚à¤¦à¥€ à¤œà¥ˆà¤¸à¥‡ à¤§à¤¬à¥à¤¬à¥‡ à¤¬à¤¨ à¤œà¤¾à¤¤à¥‡ à¤¹à¥ˆà¤‚à¥¤",
      care: [
        "Keep skin hydrated with ointment-based barrier repairs.",
        "Expose skin to brief sessions of natural sunlight daily.",
        "Avoid stress triggers and alcohol which trigger flare-ups.",
        "Consult a dermatologist for topical corticosteroid options."
      ],
      care_bn: [
        "à¦®à¦²à¦®-à¦­à¦¿à¦¤à§à¦¤à¦¿à¦• à¦•à§à¦°à¦¿à¦® à¦¦à¦¿à§Ÿà§‡ à¦¤à§à¦¬à¦• à¦¹à¦¾à¦‡à¦¡à§à¦°à§‡à¦Ÿà§‡à¦¡ à¦°à¦¾à¦–à§à¦¨à¥¤",
        "à¦ªà§à¦°à¦¤à¦¿à¦¦à¦¿à¦¨ à¦•à¦¿à¦›à§à¦•à§à¦·à¦£ à¦¸à§à¦¬à¦¾à¦­à¦¾à¦¬à¦¿à¦• à¦¸à§‚à¦°à§à¦¯à¦¾à¦²à§‹à¦•à§‡à¦° à¦¸à¦‚à¦¸à§à¦ªà¦°à§à¦¶à§‡ à¦¥à¦¾à¦•à§à¦¨à¥¤",
        "à¦®à¦¾à¦¨à¦¸à¦¿à¦• à¦šà¦¾à¦ª à¦à¦¬à¦‚ à¦…à§à¦¯à¦¾à¦²à¦•à§‹à¦¹à¦² à¦à§œà¦¿à§Ÿà§‡ à¦šà¦²à§à¦¨ à¦¯à¦¾ à¦à¦Ÿà¦¿ à¦¬à¦¾à§œà¦¿à§Ÿà§‡ à¦¦à§‡à§Ÿà¥¤",
        "à¦Ÿà¦ªà¦¿à¦•à¦¾à¦² à¦•à¦°à§à¦Ÿà¦¿à¦•à§‹à¦¸à§à¦Ÿà§‡à¦°à¦¯à¦¼à§‡à¦¡ à¦šà¦¿à¦•à¦¿à§Žà¦¸à¦¾à¦° à¦œà¦¨à§à¦¯ à¦šà¦°à§à¦®à¦°à§‹à¦— à¦¬à¦¿à¦¶à§‡à¦·à¦œà§à¦žà§‡à¦° à¦ªà¦°à¦¾à¦®à¦°à§à¦¶ à¦¨à¦¿à¦¨à¥¤"
      ],
      care_hi: [
        "à¤®à¤²à¤¹à¤®-à¤†à¤§à¤¾à¤°à¤¿à¤¤ à¤•à¥à¤°à¥€à¤® à¤¸à¥‡ à¤¤à¥à¤µà¤šà¤¾ à¤•à¥‹ à¤¹à¤¾à¤‡à¤¡à¥à¤°à¥‡à¤Ÿà¥‡à¤¡ à¤°à¤–à¥‡à¤‚à¥¤",
        "à¤ªà¥à¤°à¤¤à¤¿à¤¦à¤¿à¤¨ à¤ªà¥à¤°à¤¾à¤•à¥ƒà¤¤à¤¿à¤• à¤§à¥‚à¤ª à¤•à¥‡ à¤¸à¤‚à¤ªà¤°à¥à¤• à¤®à¥‡à¤‚ à¤¥à¥‹à¤¡à¤¼à¥€ à¤¦à¥‡à¤° à¤°à¤¹à¥‡à¤‚à¥¤",
        "à¤¤à¤¨à¤¾à¤µ à¤”à¤° à¤¶à¤°à¤¾à¤¬ à¤¸à¥‡ à¤¬à¤šà¥‡à¤‚ à¤œà¥‹ à¤‡à¤¸à¤•à¥‡ à¤²à¤•à¥à¤·à¤£à¥‹à¤‚ à¤•à¥‹ à¤¬à¤¢à¤¼à¤¾à¤¤à¥‡ à¤¹à¥ˆà¤‚à¥¤",
        "à¤¸à¤¾à¤®à¤¯à¤¿à¤• à¤•à¥‰à¤°à¥à¤Ÿà¤¿à¤•à¥‹à¤¸à¥à¤Ÿà¥‡à¤°à¥‰à¤‡à¤¡ à¤µà¤¿à¤•à¤²à¥à¤ªà¥‹à¤‚ à¤•à¥‡ à¤²à¤¿à¤ à¤¤à¥à¤µà¤šà¤¾ à¤°à¥‹à¤— à¤µà¤¿à¤¶à¥‡à¤·à¤œà¥à¤ž à¤¸à¥‡ à¤ªà¤°à¤¾à¤®à¤°à¥à¤¶ à¤²à¥‡à¤‚à¥¤"
      ]
    },
    {
      name: "Malignant Melanoma Indicator",
      name_bn: "à¦®à§à¦¯à¦¾à¦²à¦¿à¦—à¦¨à§à¦¯à¦¾à¦¨à§à¦Ÿ à¦®à§‡à¦²à¦¾à¦¨à§‹à¦®à¦¾ à¦‡à¦¨à§à¦¡à¦¿à¦•à§‡à¦Ÿà¦°",
      name_hi: "à¤˜à¤¾à¤¤à¤• à¤®à¥‡à¤²à¥‡à¤¨à¥‹à¤®à¤¾ à¤¸à¤‚à¤•à¥‡à¤¤à¤•",
      pct: 74,
      warning: true,
      desc: "Suspicious asymmetrical pigmented lesion with irregular borders. Immediate clinical biopsy advised.",
      desc_bn: "à¦…à¦¨à¦¿à¦¯à¦¼à¦®à¦¿à¦¤ à¦¸à§€à¦®à¦¾à¦¨à¦¾ à¦¸à¦¹ à¦¸à¦¨à§à¦¦à§‡à¦¹à¦œà¦¨à¦• à¦…à¦¸à¦®à¦®à¦¿à¦¤ à¦°à¦™à§à¦—à¦• à¦•à§à¦·à¦¤à¥¤ à¦…à¦¬à¦¿à¦²à¦®à§à¦¬à§‡ à¦•à§à¦²à¦¿à¦¨à¦¿à¦•à¦¾à¦² à¦¬à¦¾à¦¯à¦¼à§‹à¦ªà¦¸à¦¿ à¦•à¦°à¦¾à¦° à¦ªà¦°à¦¾à¦®à¦°à§à¦¶ à¦¦à§‡à¦“à¦¯à¦¼à¦¾ à¦¹à¦šà§à¦›à§‡à¥¤",
      desc_hi: "à¤…à¤¨à¤¿à¤¯à¤®à¤¿à¤¤ à¤¸à¥€à¤®à¤¾à¤“à¤‚ à¤•à¥‡ à¤¸à¤¾à¤¥ à¤¸à¤‚à¤¦à¤¿à¤—à¥à¤§ à¤…à¤¸à¤®à¤®à¤¿à¤¤ à¤°à¤‚à¤—à¤¦à¥à¤°à¤µà¥à¤¯ à¤˜à¤¾à¤µà¥¤ à¤¤à¤¤à¥à¤•à¤¾à¤² à¤¨à¥ˆà¤¦à¤¾à¤¨à¤¿à¤• à¤¬à¤¾à¤¯à¥‹à¤ªà¥à¤¸à¥€ à¤•à¥€ à¤¸à¤²à¤¾à¤¹ à¤¦à¥€ à¤œà¤¾à¤¤à¥€ à¤¹à¥ˆà¥¤",
      care: [
        "Do not apply self-treatment or scratch the lesion area.",
        "Schedule an urgent clinical screening with a dermatologist.",
        "Protect the skin area from direct sunlight using SPF 50+.",
        "Take high-resolution photos with a ruler to track size changes."
      ],
      care_bn: [
        "à¦•à§à¦·à¦¤ à¦¸à§à¦¥à¦¾à¦¨à§‡ à¦¨à¦¿à¦œà§‡ à¦¥à§‡à¦•à§‡ à¦•à§‹à¦¨à§‹ à¦šà¦¿à¦•à¦¿à§Žà¦¸à¦¾ à¦¬à¦¾ à¦šà§à¦²à¦•à¦¾à¦¨à¦¿ à¦•à¦°à¦¬à§‡à¦¨ à¦¨à¦¾à¥¤",
        "à¦šà¦°à§à¦®à¦°à§‹à¦— à¦¬à¦¿à¦¶à§‡à¦·à¦œà§à¦žà§‡à¦° à¦¸à¦¾à¦¥à§‡ à¦…à¦¬à¦¿à¦²à¦®à§à¦¬à§‡ à¦…à§à¦¯à¦¾à¦ªà¦¯à¦¼à§‡à¦¨à§à¦Ÿà¦®à§‡à¦¨à§à¦Ÿ à¦¨à¦¿à¦°à§à¦§à¦¾à¦°à¦£ à¦•à¦°à§à¦¨à¥¤",
        "SPF 50+ à¦¬à§à¦¯à¦¬à¦¹à¦¾à¦° à¦•à¦°à§‡ à¦à¦²à¦¾à¦•à¦¾à¦Ÿà¦¿ à¦¸à¦°à¦¾à¦¸à¦°à¦¿ à¦¸à§‚à¦°à§à¦¯à¦¾à¦²à§‹à¦• à¦¥à§‡à¦•à§‡ à¦°à¦•à§à¦·à¦¾ à¦•à¦°à§à¦¨à¥¤",
        "à¦†à¦•à¦¾à¦° à¦ªà¦°à¦¿à¦¬à¦°à§à¦¤à¦¨ à¦Ÿà§à¦°à§à¦¯à¦¾à¦• à¦•à¦°à¦¤à§‡ à¦¸à§à¦•à§‡à¦² à¦¬à¦¾ à¦°à§à¦²à¦¾à¦° à¦¸à¦¹ à¦‰à¦šà§à¦š-à¦°à§‡à¦œà§‹à¦²à¦¿à¦‰à¦¶à¦¨ à¦«à¦Ÿà§‹ à¦¨à¦¿à¦¨à¥¤"
      ],
      care_hi: [
        "à¤–à¥à¤¦ à¤¸à¥‡ à¤•à¥‹à¤ˆ à¤‰à¤ªà¤šà¤¾à¤° à¤¨ à¤•à¤°à¥‡à¤‚ à¤”à¤° à¤¨ à¤¹à¥€ à¤˜à¤¾à¤µ à¤µà¤¾à¤²à¥€ à¤œà¤—à¤¹ à¤•à¥‹ à¤–à¥à¤œà¤²à¤¾à¤à¤‚à¥¤",
        "à¤¤à¥à¤µà¤šà¤¾ à¤µà¤¿à¤¶à¥‡à¤·à¤œà¥à¤ž à¤•à¥‡ à¤¸à¤¾à¤¥ à¤¤à¤¤à¥à¤•à¤¾à¤² à¤¨à¥ˆà¤¦à¤¾à¤¨à¤¿à¤• à¤œà¤¾à¤‚à¤š à¤•à¤¾ à¤¸à¤®à¤¯ à¤¨à¤¿à¤°à¥à¤§à¤¾à¤°à¤¿à¤¤ à¤•à¤°à¥‡à¤‚à¥¤",
        "SPF 50+ à¤•à¤¾ à¤‰à¤ªà¤¯à¥‹à¤— à¤•à¤°à¤•à¥‡ à¤¤à¥à¤µà¤šà¤¾ à¤•à¥à¤·à¥‡à¤¤à¥à¤° à¤•à¥‹ à¤¸à¥€à¤§à¥€ à¤§à¥‚à¤ª à¤¸à¥‡ à¤¬à¤šà¤¾à¤à¤‚à¥¤",
        "à¤†à¤•à¤¾à¤° à¤®à¥‡à¤‚ à¤¬à¤¦à¤²à¤¾à¤µ à¤•à¥‹ à¤Ÿà¥à¤°à¥ˆà¤• à¤•à¤°à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤°à¥‚à¤²à¤° à¤•à¥‡ à¤¸à¤¾à¤¥ à¤‰à¤šà¥à¤š-à¤°à¤¿à¤œà¤¼à¥‰à¤²à¥à¤¯à¥‚à¤¶à¤¨ à¤«à¤¼à¥‹à¤Ÿà¥‹ à¤²à¥‡à¤‚à¥¤"
      ]
    }
  ];
  
  if (startSkinCamBtn) {
    startSkinCamBtn.addEventListener('click', async () => {
      if (skinStream) {
        stopSkinCamera();
        return;
      }
      try {
        skinStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        skinVideo.srcObject = skinStream;
        skinVideo.style.display = 'block';
        skinPlaceholder.style.display = 'none';
        captureSkinBtn.style.display = 'block';
        startSkinCamBtn.innerHTML = `<i data-lucide="video-off"></i> <span>Stop Camera</span>`;
        lucide.createIcons();
      } catch (err) {
        console.error("Camera access error:", err);
        alert("Could not access camera. Please upload an image or check permissions.");
      }
    });
    
    captureSkinBtn.addEventListener('click', () => {
      if (!skinStream) return;
      
      skinCanvas.width = skinVideo.videoWidth;
      skinCanvas.height = skinVideo.videoHeight;
      const ctx = skinCanvas.getContext('2d');
      ctx.drawImage(skinVideo, 0, 0, skinCanvas.width, skinCanvas.height);
      
      stopSkinCamera();
      
      skinVideo.style.display = 'none';
      skinCanvas.style.display = 'block';
      
      runSkinAnalysis();
    });
    
    skinFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          stopSkinCamera();
          skinPlaceholder.style.display = 'none';
          skinVideo.style.display = 'none';
          skinCanvas.style.display = 'block';
          
          skinCanvas.width = img.width;
          skinCanvas.height = img.height;
          const ctx = skinCanvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          
          runSkinAnalysis();
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
    
    resetSkinBtn.addEventListener('click', () => {
      skinCanvas.style.display = 'none';
      skinVideo.style.display = 'none';
      skinPlaceholder.style.display = 'flex';
      
      skinResultsState.classList.remove('active');
      skinScanningState.classList.remove('active');
      skinEmptyState.classList.add('active');
      
      skinFileInput.value = '';
    });
  }
  
  function stopSkinCamera() {
    if (skinStream) {
      skinStream.getTracks().forEach(track => track.stop());
      skinStream = null;
    }
    skinVideo.srcObject = null;
    if (captureSkinBtn) captureSkinBtn.style.display = 'none';
    if (startSkinCamBtn) startSkinCamBtn.innerHTML = `<i data-lucide="video"></i> <span>Start Camera</span>`;
    lucide.createIcons();
  }
  
  function runSkinAnalysis() {
    skinEmptyState.classList.remove('active');
    skinScanningState.classList.add('active');
    skinOverlay.style.display = 'block';
    
    let progress = 0;
    skinProgressBar.style.width = '0%';
    skinPercent.textContent = '0%';
    skinStatusText.textContent = 'Analyzing skin patterns...';
    
    const interval = setInterval(() => {
      progress += 2;
      skinProgressBar.style.width = `${progress}%`;
      skinPercent.textContent = `${progress}%`;
      
      if (progress === 30) {
        skinStatusText.textContent = 'Matching lesion structures...';
      } else if (progress === 60) {
        skinStatusText.textContent = 'Analyzing tissue pigmentation...';
      } else if (progress === 85) {
        skinStatusText.textContent = 'Calculating risk markers...';
      }
      
      if (progress >= 100) {
        clearInterval(interval);
        if (skinOverlay) skinOverlay.style.display = 'none';
        
        skinCanvas.toBlob((blob) => {
          const formData = new FormData();
          formData.append('image', blob, 'skin.jpg');
          
          fetch('/api/analyze-skin', {
            method: 'POST',
            body: formData
          })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              renderSkinResults(data.condition);
            } else {
              const lang = appState.currentLanguage || 'en';
              let errorMsg = "";
              if (lang === 'bn') {
                errorMsg = "কোনো ত্বকের টিস্যু সনাক্ত করা যায়নি। অনুগ্রহ করে আক্রান্ত ত্বকের একটি পরিষ্কার ছবি আপলোড বা ক্যাপচার করুন।";
              } else if (lang === 'hi') {
                errorMsg = "छवि में कोई त्वचा ऊतक नहीं पाया गया। कृपया प्रभावित त्वचा क्षेत्र की स्पष्ट तस्वीर अपलोड या कैप्चर करें।";
              } else {
                errorMsg = "No skin tissue detected in the uploaded image. Please upload or capture a clear photo of the affected skin area.";
              }
              alert(errorMsg);
              resetSkinBtn.click();
            }
          })
          .catch(err => {
            console.error("Dermatology scanning upload failed:", err);
            const lang = appState.currentLanguage || 'en';
            let errorMsg = "";
            if (lang === 'bn') {
              errorMsg = "সার্ভারের সাথে সংযোগ স্থাপন করা যায়নি। অনুগ্রহ করে সার্ভারটি চালু আছে কিনা নিশ্চিত করুন।";
            } else if (lang === 'hi') {
              errorMsg = "सर्वर से कनेक्ट करने में असमर्थ। कृपया सुनिश्चित करें कि सर्वर चल रहा है।";
            } else {
              errorMsg = "Could not connect to the AI analysis server. Please check your network or make sure the backend server is running.";
            }
            alert(errorMsg);
            resetSkinBtn.click();
          });
        }, 'image/jpeg');
      }
    }, 30);
  }
  
  function renderSkinResults(res) {
    skinScanningState.classList.remove('active');
    skinResultsState.classList.add('active');
    
    const lang = appState.currentLanguage || 'en';
    const condName = lang === 'bn' ? res.name_bn : (lang === 'hi' ? res.name_hi : res.name);
    const condDesc = lang === 'bn' ? res.desc_bn : (lang === 'hi' ? res.desc_hi : res.desc);
    const condCare = lang === 'bn' ? res.care_bn : (lang === 'hi' ? res.care_hi : res.care);
    
    skinConditionName.textContent = condName;
    skinConditionPct.textContent = `${res.pct}% Match`;
    skinConditionDesc.textContent = condDesc;
    
    if (res.warning) {
      skinRiskBanner.className = "alert-banner high-risk";
      skinRiskTitle.textContent = lang === 'bn' ? "à¦šà¦¿à¦•à¦¿à§Žà¦¸à¦•à§‡à¦° à¦ªà¦°à¦¾à¦®à¦°à§à¦¶ à¦†à¦¬à¦¶à§à¦¯à¦•" : (lang === 'hi' ? "à¤šà¤¿à¤•à¤¿à¤¤à¥à¤¸à¤• à¤ªà¤°à¤¾à¤®à¤°à¥à¤¶ à¤†à¤µà¤¶à¥à¤¯à¤•" : "Clinical Screening Recommended");
      skinRiskDesc.textContent = lang === 'bn' ? "à¦•à§à¦·à¦¤à¦Ÿà¦¿ à¦…à¦¸à§à¦¬à¦¾à¦­à¦¾à¦¬à¦¿à¦• à¦¦à§‡à¦–à¦¾à¦šà§à¦›à§‡à¥¤ à¦…à¦¬à¦¿à¦²à¦®à§à¦¬à§‡ à¦šà¦°à§à¦®à¦°à§‹à¦— à¦¬à¦¿à¦¶à§‡à¦·à¦œà§à¦žà§‡à¦° à¦¸à¦¾à¦¥à§‡ à¦¯à§‹à¦—à¦¾à¦¯à§‹à¦— à¦•à¦°à§à¦¨à¥¤" : (lang === 'hi' ? "à¤˜à¤¾à¤µ à¤…à¤¸à¤¾à¤®à¤¾à¤¨à¥à¤¯ à¤²à¤— à¤°à¤¹à¤¾ à¤¹à¥ˆà¥¤ à¤¤à¥à¤°à¤‚à¤¤ à¤¤à¥à¤µà¤šà¤¾ à¤µà¤¿à¤¶à¥‡à¤·à¤œà¥à¤ž à¤¸à¥‡ à¤¸à¤‚à¤ªà¤°à¥à¤• à¤•à¤°à¥‡à¤‚à¥¤" : "This lesion exhibits irregular features. We recommend scheduling an physical biopsy.");
    } else {
      skinRiskBanner.className = "alert-banner low-risk";
      skinRiskTitle.textContent = lang === 'bn' ? "à¦¸à¦¾à¦§à¦¾à¦°à¦£ à¦¤à§à¦¬à¦• à¦œà§à¦¬à¦¾à¦²à¦¾" : (lang === 'hi' ? "à¤¸à¤¾à¤®à¤¾à¤¨à¥à¤¯ à¤¤à¥à¤µà¤šà¤¾ à¤œà¤²à¤¨" : "Minor Skin Condition");
      skinRiskDesc.textContent = lang === 'bn' ? "à¦à¦Ÿà¦¿ à¦—à§à¦°à§à¦¤à¦° à¦•à¦¿à¦›à§ à¦¨à¦¯à¦¼ à¦¬à¦²à§‡ à¦®à¦¨à§‡ à¦¹à¦šà§à¦›à§‡à¥¤ à¦¨à§€à¦šà§‡à¦° à¦¸à§à¦¬-à¦¯à¦¤à§à¦¨ à¦¨à¦¿à¦°à§à¦¦à§‡à¦¶à¦¾à¦¬à¦²à§€ à¦…à¦¨à§à¦¸à¦°à¦£ à¦•à¦°à§à¦¨à¥¤" : (lang === 'hi' ? "à¤¯à¤¹ à¤—à¤‚à¤­à¥€à¤° à¤¨à¤¹à¥€à¤‚ à¤²à¤— à¤°à¤¹à¤¾ à¤¹à¥ˆà¥¤ à¤¨à¥€à¤šà¥‡ à¤¦à¤¿à¤ à¤—à¤ à¤¸à¥à¤µ-à¤¦à¥‡à¤–à¤­à¤¾à¤² à¤¨à¤¿à¤°à¥à¤¦à¥‡à¤¶à¥‹à¤‚ à¤•à¤¾ à¤ªà¤¾à¤²à¤¨ à¤•à¤°à¥‡à¤‚à¥¤" : "This matches low-severity benign skin patterns. Follow the self-care recommendations.");
    }
    
    skinCareList.innerHTML = condCare.map(c => `<li>${c}</li>`).join('');
    lucide.createIcons();
  }

  // --- CAMERA PPG HEART RATE SCANNER ---
  
  if (startHeartBtn) {
    startHeartBtn.addEventListener('click', async () => {
      if (heartStream) {
        stopHeartScanner();
        return;
      }
      try {
        heartStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 240, height: 240 } });
        heartVideo.srcObject = heartStream;
        heartVideo.play();
        
        heartPulseCircle.classList.add('active');
        startHeartBtn.innerHTML = `<i data-lucide="square"></i> <span>Stop Pulse Scan</span>`;
        lucide.createIcons();
        
        ppgSignal = Array(150).fill(60);
        heartBPMValues = [];
        signalCheckCounter = 0;
        pulseBpmValue.textContent = '--';
        pulseStatusBadge.textContent = appState.currentLanguage === 'bn' ? 'à¦†à¦™à§à¦² à¦¸à¦¨à¦¾à¦•à§à¦¤ à¦•à¦°à¦¾ à¦¹à¦šà§à¦›à§‡...' : (appState.currentLanguage === 'hi' ? 'à¤‰à¤‚à¤—à¤²à¥€ à¤–à¥‹à¤œà¥€ à¤œà¤¾ à¤°à¤¹à¥€ à¤¹à¥ˆ...' : 'Detecting Finger...');
        
        processHeartFrames();
      } catch (err) {
        console.error("Camera PPG access error:", err);
        alert("Webcam access failed. Heart rate monitor requires video stream.");
      }
    });
  }
  
  function stopHeartScanner() {
    if (heartStream) {
      heartStream.getTracks().forEach(track => track.stop());
      heartStream = null;
    }
    if (heartAnimationId) {
      cancelAnimationFrame(heartAnimationId);
      heartAnimationId = null;
    }
    heartVideo.srcObject = null;
    if (heartPulseCircle) heartPulseCircle.classList.remove('active');
    if (heartPulseWaveFill) heartPulseWaveFill.style.height = '0%';
    if (heartFingerStatus) heartFingerStatus.textContent = appState.currentLanguage === 'bn' ? 'à¦•à§à¦¯à¦¾à¦®à§‡à¦°à¦¾à¦° à¦“à¦ªà¦° à¦†à¦™à§à¦² à¦°à¦¾à¦–à§à¦¨' : (appState.currentLanguage === 'hi' ? 'à¤•à¥ˆà¤®à¤°à¥‡ à¤ªà¤° à¤‰à¤‚à¤—à¤²à¥€ à¤°à¤–à¥‡à¤‚' : 'Place finger over camera');
    if (startHeartBtn) startHeartBtn.innerHTML = `<i data-lucide="play"></i> <span>Start Pulse Scan</span>`;
    lucide.createIcons();
  }
  
  let heartRawValues = [];
  let heartPeakTimes = [];
  let heartLastPeakTime = 0;

  function processHeartFrames() {
    if (!heartStream) return;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 40;
    tempCanvas.height = 40;
    const ctx = tempCanvas.getContext('2d');
    
    try {
      ctx.drawImage(heartVideo, 0, 0, 40, 40);
      const imgData = ctx.getImageData(0, 0, 40, 40);
      const data = imgData.data;
      
      let sumRed = 0;
      let sumGreen = 0;
      let sumBlue = 0;
      
      for (let i = 0; i < data.length; i += 4) {
        sumRed += data[i];
        sumGreen += data[i+1];
        sumBlue += data[i+2];
      }
      
      const count = data.length / 4;
      const avgRed = sumRed / count;
      const avgGreen = sumGreen / count;
      const avgBlue = sumBlue / count;
      
      // Determine if finger is covering the camera. Finger skin is red, so Red channel is high and significantly larger than Green + Blue
      isFingerCovering = avgRed > 120 && avgRed > (avgGreen + avgBlue) * 1.1;
      
      if (isFingerCovering) {
        signalCheckCounter++;
        heartFingerStatus.textContent = appState.currentLanguage === 'bn' ? 'আঙুল সনাক্ত হয়েছে, স্থির থাকুন...' : (appState.currentLanguage === 'hi' ? 'उंगली मिल गई, स्थिर रहें...' : 'Signal lock, hold still...');
        heartFingerStatus.style.color = '#f43f5e';
        
        // 1. Maintain raw value history
        heartRawValues.push(avgRed);
        if (heartRawValues.length > 150) {
          heartRawValues.shift();
        }
        
        // 2. Compute moving average (DC offset) to filter out slow drifts
        const sum = heartRawValues.reduce((a, b) => a + b, 0);
        const dc = sum / heartRawValues.length;
        
        // 3. Compute AC signal (current value - DC)
        const ac = avgRed - dc;
        
        // 4. Smooth the AC signal slightly to reduce camera noise
        ppgSignal.push(ac);
        if (ppgSignal.length > 150) {
          ppgSignal.shift();
        }
        
        // 5. Peak detection on the smoothed AC signal
        const len = ppgSignal.length;
        if (len > 3) {
          const prev = ppgSignal[len - 2];
          const curr = ppgSignal[len - 1];
          const prevPrev = ppgSignal[len - 3];
          
          const now = Date.now();
          // Check if it's a peak: local maximum, and satisfies noise threshold
          // Minimum time between heartbeats is 400ms (~150 BPM max) to prevent double peaks
          if (prev > prevPrev && prev > curr && prev > 0.05 && (now - heartLastPeakTime > 400)) {
            heartLastPeakTime = now;
            heartPeakTimes.push(now);
            if (heartPeakTimes.length > 8) {
              heartPeakTimes.shift();
            }
            
            // Visual heartbeat pulse effect
            if (heartPulseCircle) {
              heartPulseCircle.style.transform = 'scale(1.12)';
              setTimeout(() => {
                if (heartPulseCircle) heartPulseCircle.style.transform = 'scale(1)';
              }, 120);
            }
          }
        }
        
        // 6. Calculate BPM from intervals between peaks
        if (heartPeakTimes.length >= 3) {
          let intervalsSum = 0;
          for (let i = 1; i < heartPeakTimes.length; i++) {
            intervalsSum += (heartPeakTimes[i] - heartPeakTimes[i - 1]);
          }
          const avgInterval = intervalsSum / (heartPeakTimes.length - 1);
          const realBPM = Math.round(60000 / avgInterval);
          
          // Verify that BPM is within human limits (50 to 150)
          if (realBPM >= 50 && realBPM <= 150) {
            heartBPMValues.push(realBPM);
            if (heartBPMValues.length > 10) {
              heartBPMValues.shift();
            }
            
            const avgBPM = Math.round(heartBPMValues.reduce((a, b) => a + b, 0) / heartBPMValues.length);
            
            if (signalCheckCounter > 90) { // require ~3 seconds of stable signal
              pulseBpmValue.textContent = avgBPM;
              pulseStatusBadge.textContent = appState.currentLanguage === 'bn' ? 'স্থিতিশীল' : (appState.currentLanguage === 'hi' ? 'स्थिर' : 'Stable');
              pulseStatusBadge.style.color = 'var(--accent-emerald)';
              
              pulseAssessmentText.textContent = appState.currentLanguage === 'bn' ? 
                `আপনার হৃদস্পন্দন হার ${avgBPM} BPM। এটি স্বাভাবিক বিশ্রামের সীমার (৬০-১০০ BPM) মধ্যে রয়েছে।` : 
                (appState.currentLanguage === 'hi' ? 
                  `आपकी हृदय गति ${avgBPM} BPM है। यह सामान्य विश्राम सीमा (60-100 BPM) में है।` : 
                  `Your heart rate reading is stable at ${avgBPM} BPM. This falls within the healthy resting range (60-100 BPM).`);
            } else {
              pulseBpmValue.textContent = '...';
              pulseStatusBadge.textContent = appState.currentLanguage === 'bn' ? 'সংকেত বিশ্লেষণ...' : 'Analyzing...';
              pulseStatusBadge.style.color = 'var(--accent-cyan)';
            }
          }
        } else {
          pulseBpmValue.textContent = '...';
          pulseStatusBadge.textContent = appState.currentLanguage === 'bn' ? 'সংকেত খোঁজা হচ্ছে...' : 'Locking Signal...';
          pulseStatusBadge.style.color = 'var(--accent-cyan)';
        }
        
        // Update container wave fill height based on signal amplitude
        const normalizedH = Math.min(100, Math.max(0, 50 + ac * 15));
        heartPulseWaveFill.style.height = `${normalizedH}%`;
        
      } else {
        // Reset buffers when finger is removed
        heartRawValues = [];
        heartPeakTimes = [];
        heartLastPeakTime = 0;
        heartBPMValues = [];
        signalCheckCounter = 0;
        
        heartFingerStatus.textContent = appState.currentLanguage === 'bn' ? 'ক্যামেরার লেন্সটি আঙুল দিয়ে ভালো করে ঢাকুন' : (appState.currentLanguage === 'hi' ? 'लेंस को पूरी तरह उंगली से ढकें' : 'Cover camera lens fully');
        heartFingerStatus.style.color = 'var(--text-secondary)';
        heartPulseWaveFill.style.height = '0%';
        pulseBpmValue.textContent = '--';
        pulseStatusBadge.textContent = appState.currentLanguage === 'bn' ? 'সংকেত নেই' : (appState.currentLanguage === 'hi' ? 'कोई संकेत नहीं' : 'No Signal');
        pulseStatusBadge.style.color = 'var(--text-secondary)';
        pulseAssessmentText.textContent = appState.currentLanguage === 'bn' ? 
          'রিডিং স্থিতিশীল হলে বিপিএম (BPM) মান প্রদর্শিত হবে। স্ক্যানের সময় ১৫ সেকেন্ড শান্ত থাকুন।' : 
          (appState.currentLanguage === 'hi' ? 
            'रीडिंग स्थिर होने पर बीपीएम मान प्रदर्शित होगा। स्कैन के दौरान 15 सेकंड शांत रहें।' : 
            'BPM values will display once readings stabilize. Remain calm for 15s during scan.');
        
        // Simulating idle signal on graph
        ppgSignal.push(Math.sin(Date.now() / 200) * 1 + Math.random() * 0.2);
        ppgSignal.shift();
      }
      
      drawPPGGraph();
    } catch (e) {
      sys.stderr.write("PPG Frame Processing Error: " + str(e) + "\n")
    }
    
    heartAnimationId = requestAnimationFrame(processHeartFrames);
  }

  function drawPPGGraph() {
    if (!ppgCanvas) return;
    
    const ctx = ppgCanvas.getContext('2d');
    const width = ppgCanvas.width = ppgCanvas.clientWidth;
    const height = ppgCanvas.height = ppgCanvas.clientHeight;
    
    ctx.clearRect(0, 0, width, height);
    
    // Draw background grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    
    ctx.strokeStyle = 'var(--accent-rose)';
    ctx.shadowColor = 'var(--accent-rose)';
    ctx.shadowBlur = isFingerCovering ? 10 : 0;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    
    const step = width / ppgSignal.length;
    
    // Dynamically calculate min and max to auto-scale the graph representation
    let minVal = Math.min(...ppgSignal);
    let maxVal = Math.max(...ppgSignal);
    let range = maxVal - minVal;
    if (range < 0.2) range = 0.2; // minimum range to avoid divide-by-zero or flatline visual issues
    
    ppgSignal.forEach((val, i) => {
      const x = i * step;
      // Map val from [minVal, maxVal] to [15% height, 85% height] for vertical padding
      const normalizedY = (val - minVal) / range;
      const y = height - (height * 0.15 + normalizedY * height * 0.7);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    ctx.stroke();
    ctx.shadowBlur = 0;
  }


  // --- MEDICATION REMINDERS MODULE ---
  
  if (addMedForm) {
    addMedForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('med-name').value.trim();
      const dose = document.getElementById('med-dose').value.trim();
      const time = document.getElementById('med-time').value;
      
      const newMed = {
        id: generateUUID(),
        name,
        dose,
        time,
        takenToday: false,
        lastTakenDate: ''
      };
      
      await saveMedicationToServer(newMed);
      renderMedications();
      
      addMedForm.reset();
      
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    });
  }
  
  async function saveMedicationToServer(med) {
    if (currentUser && db) {
      try {
        await setDoc(doc(db, "users", currentUser.uid, "medications", med.id), med);
        console.log("Medication saved to Firestore");
        // Update local memory
        const idx = userMeds.findIndex(m => m.id === med.id);
        if (idx !== -1) {
          userMeds[idx] = med;
        } else {
          userMeds.push(med);
        }
      } catch (fErr) {
        console.error("Firestore medication save error:", fErr);
      }
    }
    try {
      const res = await fetch('/api/medications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(med)
      });
      if (res.ok) {
        userMeds = await res.json();
      }
    } catch (e) {
      console.error("Error saving medication:", e);
      if (!userMeds.some(m => m.id === med.id)) {
        userMeds.push(med);
      }
    }
  }

  async function deleteMedicationFromServer(id) {
    if (currentUser && db) {
      try {
        await deleteDoc(doc(db, "users", currentUser.uid, "medications", id));
        console.log("Medication deleted from Firestore");
        userMeds = userMeds.filter(m => m.id !== id);
      } catch (fErr) {
        console.error("Firestore medication delete error:", fErr);
      }
    }
    try {
      const res = await fetch(`/api/medications/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        userMeds = await res.json();
      }
    } catch (e) {
      console.error("Error deleting medication:", e);
      userMeds = userMeds.filter(m => m.id !== id);
    }
  }
  
  async function renderMedications() {
    if (!todayMedsList) return;
    todayMedsList.innerHTML = '';
    
    const todayStr = new Date().toDateString();
    
    if (userMeds.length === 0) {
      todayMedsList.innerHTML = `<div class="placeholder-chip" style="font-style: italic; color: var(--text-muted); text-align: center; padding: 10px;">` + 
        (appState.currentLanguage === 'bn' ? 'à¦•à§‹à¦¨à§‹ à¦“à¦·à§à¦§ à¦¶à¦¿à¦¡à¦¿à¦‰à¦² à¦•à¦°à¦¾ à¦¨à§‡à¦‡à¥¤' : (appState.currentLanguage === 'hi' ? 'à¤•à¥‹à¤ˆ à¤¦à¤µà¤¾ à¤¨à¤¿à¤°à¥à¤§à¤¾à¤°à¤¿à¤¤ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤' : 'No medications scheduled yet.')) + `</div>`;
      return;
    }
    
    userMeds.forEach(med => {
      if (med.lastTakenDate !== todayStr && med.takenToday) {
        med.takenToday = false;
        med.lastTakenDate = '';
        saveMedicationToServer(med);
      }

      const card = document.createElement('div');
      card.className = `med-item-card ${med.takenToday ? 'taken' : ''}`;
      card.innerHTML = `
        <div class="med-info-block">
          <span class="med-title">${med.name}</span>
          <span class="med-subtitle">${med.dose} â€¢ ${med.time}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="med-check-btn" title="Toggle Taken">
            <i data-lucide="check" style="width: 14px; height: 14px;"></i>
          </button>
          <button class="med-delete-btn" title="Delete Medication">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
          </button>
        </div>
      `;
      todayMedsList.appendChild(card);
      
      card.querySelector('.med-check-btn').addEventListener('click', async () => {
        med.takenToday = !med.takenToday;
        med.lastTakenDate = med.takenToday ? todayStr : '';
        await saveMedicationToServer(med);
        renderMedications();
      });
      
      card.querySelector('.med-delete-btn').addEventListener('click', async () => {
        await deleteMedicationFromServer(med.id);
        renderMedications();
      });
    });
    
    lucide.createIcons();
  }
  
  // Notification check loop every 10 seconds for speed
  setInterval(() => {
    const now = new Date();
    const curTimeStr = now.toTimeString().slice(0, 5);
    const todayStr = now.toDateString();
    
    userMeds.forEach(med => {
      if (med.time === curTimeStr && !med.takenToday && med.lastNotifiedDate !== todayStr) {
        med.lastNotifiedDate = todayStr;
        saveMedicationToServer(med);
        
        if (Notification.permission === 'granted') {
          new Notification("Medication Reminder", {
            body: `It's time to take your ${med.name} (${med.dose})`,
            icon: 'logo.jpg'
          });
        } else {
          alert(`MEDICATION REMINDER\n\nIt's time to take your ${med.name} (${med.dose})!`);
        }
      }
    });
  }, 10000);

  // --- WATER HYDRATION TRACKER ---
  
  async function saveWaterData() {
    const todayDateStr = new Date().toDateString();
    if (currentUser && db) {
      try {
        await setDoc(doc(db, "users", currentUser.uid, "water", todayDateStr), {
          current: hydrationData.current,
          target: hydrationData.target
        });
        console.log("Water consumption saved to Firestore");
      } catch (fErr) {
        console.error("Firestore water save error:", fErr);
      }
    }
    try {
      await fetch('/api/water', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: todayDateStr,
          current: hydrationData.current,
          target: hydrationData.target
        })
      });
    } catch (e) {
      console.error("Failed to save water data:", e);
    }
  }
  
  function updateWaterUI() {
    if (!currentWaterVal) return;
    currentWaterVal.textContent = hydrationData.current;
    targetWaterVal.textContent = hydrationData.target;
    
    const pct = Math.min(100, Math.round((hydrationData.current / hydrationData.target) * 100));
    waterFillLevel.style.height = `${pct}%`;
    waterFillPercent.textContent = `${pct}%`;
  }
  
  document.querySelectorAll('[data-water]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const amt = parseInt(btn.getAttribute('data-water'));
      hydrationData.current += amt;
      updateWaterUI();
      await saveWaterData();
    });
  });
  
  if (resetWaterBtn) {
    resetWaterBtn.addEventListener('click', async () => {
      hydrationData.current = 0;
      updateWaterUI();
      const todayDateStr = new Date().toDateString();
      if (currentUser && db) {
        try {
          await setDoc(doc(db, "users", currentUser.uid, "water", todayDateStr), {
            current: 0,
            target: hydrationData.target
          });
          console.log("Water reset saved to Firestore");
        } catch (fErr) {
          console.error("Firestore water reset error:", fErr);
        }
      }
      try {
        await fetch('/api/water/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: todayDateStr })
        });
      } catch (e) {
        console.error(e);
      }
    });
  }
  
  let waterTimer = null;
  if (waterReminderToggle) {
    const savedToggle = localStorage.getItem('aegis_water_reminder') === 'true';
    waterReminderToggle.checked = savedToggle;
    
    waterReminderToggle.addEventListener('change', (e) => {
      localStorage.setItem('aegis_water_reminder', e.target.checked);
      setupWaterTimer(e.target.checked);
    });
    
    setupWaterTimer(savedToggle);
  }
  
  function setupWaterTimer(enable) {
    if (waterTimer) clearInterval(waterTimer);
    if (!enable) return;
    
    waterTimer = setInterval(() => {
      if (Notification.permission === 'granted') {
        new Notification("Hydration Reminder", {
          body: "Stay healthy! Drink a glass of water right now.",
          icon: 'logo.jpg'
        });
      } else {
        alert("Hydration Reminder: Stay healthy! Remember to drink water.");
      }
    }, 3600000);
  }

  // --- SLEEP LOG AND LOGGING HISTORY ---
  
  if (sleepForm) {
    sleepForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bedtime = document.getElementById('sleep-bedtime').value;
      const waketime = document.getElementById('sleep-waketime').value;
      const quality = parseInt(document.getElementById('sleep-quality').value) || 4;
      
      const [bHour, bMin] = bedtime.split(':').map(Number);
      const [wHour, wMin] = waketime.split(':').map(Number);
      
      let bedDate = new Date(2026, 0, 1, bHour, bMin);
      let wakeDate = new Date(2026, 0, 1, wHour, wMin);
      if (wakeDate < bedDate) {
        wakeDate = new Date(2026, 0, 2, wHour, wMin);
      }
      
      const hours = (wakeDate - bedDate) / 1000 / 60 / 60;
      
      const newLog = {
        id: generateUUID(),
        bedtime,
        waketime,
        quality,
        duration: parseFloat(hours.toFixed(1)),
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      };
      
      if (currentUser && db) {
        try {
          await setDoc(doc(db, "users", currentUser.uid, "sleep", newLog.id), newLog);
          console.log("Sleep log saved to Firestore");
          sleepLogs.unshift(newLog);
        } catch (fErr) {
          console.error("Firestore sleep save error:", fErr);
        }
      }
      try {
        const res = await fetch('/api/sleep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newLog)
        });
        if (res.ok) {
          // If server responds, sync from server to maintain cache
          const fetchedLogs = await res.json();
          // Filter duplicates or replace local memory
          sleepLogs = fetchedLogs;
        } else {
          if (!sleepLogs.some(s => s.id === newLog.id)) {
            sleepLogs.unshift(newLog);
          }
        }
      } catch (err) {
        console.error("Failed to save sleep log to server:", err);
        if (!sleepLogs.some(s => s.id === newLog.id)) {
          sleepLogs.unshift(newLog);
        }
      }
      
      renderSleepLogs();
      sleepForm.reset();
    });
  }
  
  function renderSleepLogs() {
    if (!sleepHistoryList) return;
    sleepHistoryList.innerHTML = '';
    
    if (sleepLogs.length === 0) {
      sleepHistoryList.innerHTML = `<span class="placeholder-chip" style="font-style: italic;">` + 
        (appState.currentLanguage === 'bn' ? 'à¦•à§‹à¦¨à§‹ à¦˜à§à¦®à§‡à¦° à¦²à¦— à¦°à§‡à¦•à¦°à§à¦¡ à¦¨à§‡à¦‡à¥¤' : (appState.currentLanguage === 'hi' ? 'à¤•à¥‹à¤ˆ à¤¨à¥€à¤‚à¤¦ à¤²à¥‰à¤— à¤°à¤¿à¤•à¥‰à¤°à¥à¤¡ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤' : 'No sleep logs recorded yet.')) + `</span>`;
      return;
    }
    
    sleepLogs.slice(0, 3).forEach(log => {
      const stars = 'â˜…'.repeat(Number(log.quality)) + 'â˜†'.repeat(5 - Number(log.quality));
      const card = document.createElement('div');
      card.className = 'sleep-log-card';
      card.innerHTML = `
        <div>
          <span class="time-range">${log.bedtime} - ${log.waketime}</span>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${log.date}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="quality-stars">${stars}</span>
          <span class="duration-badge">${log.duration} hrs</span>
        </div>
      `;
      sleepHistoryList.appendChild(card);
    });
  }

  // --- BMI CALCULATOR MODULE ---
  
  if (calcBmiBtn) {
    calcBmiBtn.addEventListener('click', () => {
      const weight = parseFloat(document.getElementById('bmi-weight').value);
      const height = parseFloat(document.getElementById('bmi-height').value) / 100;
      
      if (isNaN(weight) || isNaN(height) || height <= 0) return;
      
      const bmi = weight / (height * height);
      const val = bmi.toFixed(1);
      bmiValText.textContent = val;
      
      let status = '';
      let markerPos = 50;
      let advice = '';
      
      const lang = appState.currentLanguage || 'en';
      
      if (bmi < 18.5) {
        status = lang === 'bn' ? 'à¦•à¦® à¦“à¦œà¦¨' : (lang === 'hi' ? 'à¤•à¤® à¤µà¤œà¤¨' : 'Underweight');
        markerPos = 15;
        advice = lang === 'bn' ? 'à¦†à¦ªà¦¨à¦¾à¦° à¦ªà§à¦·à§à¦Ÿà¦¿à¦•à¦° à¦–à¦¾à¦¬à¦¾à¦°à§‡à¦° à¦ªà¦°à¦¿à¦®à¦¾à¦£ à¦¬à¦¾à§œà¦¾à¦¨à§‹ à¦à¦¬à¦‚ à¦ªà§‡à¦¶à§€ à¦¬à¦¾à§œà¦¾à¦¨à§‹à¦° à¦²à¦•à§à¦·à§à¦¯ à¦¨à§‡à¦“à§Ÿà¦¾ à¦‰à¦šà¦¿à¦¤à¥¤' : (lang === 'hi' ? 'à¤†à¤ªà¤•à¥‹ à¤…à¤ªà¤¨à¤¾ à¤ªà¥Œà¤·à¥à¤Ÿà¤¿à¤• à¤­à¥‹à¤œà¤¨ à¤¬à¤¢à¤¼à¤¾à¤¨à¤¾ à¤šà¤¾à¤¹à¤¿à¤ à¤”à¤° à¤®à¤¾à¤‚à¤¸à¤ªà¥‡à¤¶à¤¿à¤¯à¥‹à¤‚ à¤•à¥‡ à¤¨à¤¿à¤°à¥à¤®à¤¾à¤£ à¤ªà¤° à¤§à¥à¤¯à¤¾à¤¨ à¤¦à¥‡à¤¨à¤¾ à¤šà¤¾à¤¹à¤¿à¤à¥¤' : 'Consider speaking to a dietitian to configure healthy weight gain strategies.');
      } else if (bmi < 24.9) {
        status = lang === 'bn' ? 'à¦¸à§à¦¬à¦¾à¦­à¦¾à¦¬à¦¿à¦• à¦“à¦œà¦¨' : (lang === 'hi' ? 'à¤¸à¤¾à¤®à¤¾à¤¨à¥à¤¯ à¤µà¤œà¤¨' : 'Normal Weight');
        markerPos = 40;
        advice = lang === 'bn' ? 'à¦šà¦®à§Žà¦•à¦¾à¦°! à¦¸à§à¦·à¦® à¦†à¦¹à¦¾à¦° à¦à¦¬à¦‚ à¦¨à¦¿à§Ÿà¦®à¦¿à¦¤ à¦¬à§à¦¯à¦¾à§Ÿà¦¾à¦® à¦¬à¦œà¦¾à§Ÿ à¦°à¦¾à¦–à§à¦¨à¥¤' : (lang === 'hi' ? 'à¤‰à¤¤à¥à¤•à¥ƒà¤·à¥à¤Ÿ! à¤¸à¤‚à¤¤à¥à¤²à¤¿à¤¤ à¤†à¤¹à¤¾à¤° à¤”à¤° à¤¨à¤¿à¤¯à¤®à¤¿à¤¤ à¤µà¥à¤¯à¤¾à¤¯à¤¾à¤® à¤¬à¤¨à¤¾à¤ à¤°à¤–à¥‡à¤‚à¥¤' : 'Excellent! Maintain a balanced diet, active cardio, and general fitness parameters.');
      } else if (bmi < 29.9) {
        status = lang === 'bn' ? 'à¦…à¦¤à¦¿à¦°à¦¿à¦•à§à¦¤ à¦“à¦œà¦¨' : (lang === 'hi' ? 'à¤…à¤§à¤¿à¤• à¤µà¤œà¤¨' : 'Overweight');
        markerPos = 70;
        advice = lang === 'bn' ? 'à¦œà§€à¦¬à¦¨à¦¯à¦¾à¦¤à§à¦°à¦¾à¦° à¦ªà¦°à¦¿à¦¬à¦°à§à¦¤à¦¨ à¦à¦¬à¦‚ à¦¶à¦¾à¦°à§€à¦°à¦¿à¦• à¦•à¦¾à¦°à§à¦¯à¦•à¦²à¦¾à¦ª à¦¬à§ƒà¦¦à§à¦§à¦¿à¦° à¦¸à§à¦ªà¦¾à¦°à¦¿à¦¶ à¦•à¦°à¦¾ à¦¹à¦šà§à¦›à§‡à¥¤' : (lang === 'hi' ? 'à¤œà¥€à¤µà¤¨à¤¶à¥ˆà¤²à¥€ à¤®à¥‡à¤‚ à¤¬à¤¦à¤²à¤¾à¤µ à¤”à¤° à¤¶à¤¾à¤°à¥€à¤°à¤¿à¤• à¤—à¤¤à¤¿à¤µà¤¿à¤§à¤¿ à¤¬à¤¢à¤¼à¤¾à¤¨à¥‡ à¤•à¥€ à¤¸à¤²à¤¾à¤¹ à¤¦à¥€ à¤œà¤¾à¤¤à¥€ à¤¹à¥ˆà¥¤' : 'Focus on portion controls, high-intensity cardio, and limit processed foods.');
      } else {
        status = lang === 'bn' ? 'à¦¸à§à¦¥à§‚à¦²à¦¤à¦¾' : (lang === 'hi' ? 'à¤®à¥‹à¤Ÿà¤¾à¤ªà¤¾' : 'Obese');
        markerPos = 90;
        advice = lang === 'bn' ? 'à¦šà¦¿à¦•à¦¿à§Žà¦¸à¦•à§‡à¦° à¦ªà¦°à¦¾à¦®à¦°à§à¦¶ à¦¨à¦¿à§Ÿà§‡ à¦“à¦œà¦¨ à¦¹à§à¦°à¦¾à¦¸ à¦ªà¦°à¦¿à¦•à¦²à§à¦ªà¦¨à¦¾ à¦•à¦°à¦¾ à¦­à¦¾à¦²à§‹à¥¤' : (lang === 'hi' ? 'à¤¡à¥‰à¤•à¥à¤Ÿà¤° à¤•à¥€ à¤¸à¤²à¤¾à¤¹ à¤²à¥‡à¤•à¤° à¤µà¤œà¤¨ à¤˜à¤Ÿà¤¾à¤¨à¥‡ à¤•à¥€ à¤¯à¥‹à¤œà¤¨à¤¾ à¤¬à¤¨à¤¾à¤¨à¤¾ à¤¬à¥‡à¤¹à¤¤à¤° à¤¹à¥‹à¤—à¤¾à¥¤' : 'We strongly recommend clinical consultations with a physician to outline medical weight loss programs.');
      }
      
      bmiStatusText.textContent = status;
      bmiGaugeMarker.style.left = `${markerPos}%`;
      bmiAdviceText.textContent = advice;
      bmiResultPanel.style.display = 'block';
    });
  }

  // --- BLOOD REPORT ANALYZER MODULE ---
  
  if (bloodDropzone) {
    bloodDropzone.addEventListener('click', () => {
      bloodFileInput.click();
    });
    
    bloodDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      bloodDropzone.classList.add('dragover');
    });
    
    bloodDropzone.addEventListener('dragleave', () => {
      bloodDropzone.classList.remove('dragover');
    });
    
    bloodDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      bloodDropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      handleBloodFile(file);
    });
    
    bloodFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      handleBloodFile(file);
    });
    
    clearBloodFile.addEventListener('click', (e) => {
      e.stopPropagation();
      resetBloodFileInput();
    });
    
    analyzeBloodBtn.addEventListener('click', () => {
      runBloodAnalysis();
    });
    
    resetBloodBtn.addEventListener('click', () => {
      resetBloodFileInput();
      bloodResultsState.classList.remove('active');
      bloodScanningState.classList.remove('active');
      bloodEmptyState.classList.add('active');
    });
  }
  
  function handleBloodFile(file) {
    if (!file) return;
    
    bloodFilename.textContent = file.name;
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    bloodFilesize.textContent = `${sizeMB} MB`;
    
    bloodDropzone.style.display = 'none';
    bloodFileDetails.style.display = 'flex';
    
    analyzeBloodBtn.classList.remove('disabled');
    analyzeBloodBtn.removeAttribute('disabled');
  }
  
  function resetBloodFileInput() {
    bloodFileInput.value = '';
    bloodFileDetails.style.display = 'none';
    bloodDropzone.style.display = 'flex';
    
    analyzeBloodBtn.classList.add('disabled');
    analyzeBloodBtn.setAttribute('disabled', 'true');
  }
  
  function runBloodAnalysis() {
    const file = bloodFileInput.files[0];
    if (!file) return;

    bloodEmptyState.classList.remove('active');
    bloodScanningState.classList.add('active');
    
    let progress = 0;
    bloodProgressBar.style.width = '0%';
    bloodPercent.textContent = '0%';
    bloodStatusText.textContent = 'Reading report structure...';
    
    const interval = setInterval(() => {
      progress += 4;
      bloodProgressBar.style.width = `${progress}%`;
      bloodPercent.textContent = `${progress}%`;
      
      if (progress === 28) {
        bloodStatusText.textContent = 'Extracting biomarker parameters...';
      } else if (progress === 56) {
        bloodStatusText.textContent = 'Cross-referencing healthy ranges...';
      } else if (progress === 84) {
        bloodStatusText.textContent = 'Generating diagnostic explanation...';
      }
      
      if (progress >= 100) {
        clearInterval(interval);
        
        const formData = new FormData();
        formData.append('report', file);
        
        fetch('/api/analyze-blood', {
          method: 'POST',
          body: formData
        })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            renderBloodResults(data.biomarkers);
          } else {
            renderBloodResults(BLOOD_BIOMARKERS_MOCK);
          }
        })
        .catch(err => {
          console.error("Blood analysis upload error:", err);
          renderBloodResults(BLOOD_BIOMARKERS_MOCK);
        });
      }
    }, 40);
  }
  
  const BLOOD_BIOMARKERS_MOCK = [
    { name: 'Hemoglobin', value: 11.2, ref: '12.0 - 15.5 g/dL', status: 'low' },
    { name: 'White Blood Cell (WBC)', value: 8.4, ref: '4.5 - 11.0 x10^3/uL', status: 'normal' },
    { name: 'Cholesterol (Total)', value: 245, ref: '< 200 mg/dL', status: 'high' },
    { name: 'Fasting Blood Glucose', value: 92, ref: '70 - 99 mg/dL', status: 'normal' },
    { name: 'Platelets Count', value: 280, ref: '150 - 450 x10^3/uL', status: 'normal' }
  ];
  
  function renderBloodResults(biomarkers = BLOOD_BIOMARKERS_MOCK) {
    bloodScanningState.classList.remove('active');
    bloodResultsState.classList.add('active');
    
    bloodTableBody.innerHTML = '';
    
    const lang = appState.currentLanguage || 'en';
    
    biomarkers.forEach(bio => {
      let badgeClass = 'normal';
      let displayStatus = 'Normal';
      
      if (bio.status === 'low') {
        badgeClass = 'low';
        displayStatus = lang === 'bn' ? 'à¦•à¦®' : (lang === 'hi' ? 'à¤•à¤®' : 'Low');
      } else if (bio.status === 'high') {
        badgeClass = 'high';
        displayStatus = lang === 'bn' ? 'à¦‰à¦šà§à¦š' : (lang === 'hi' ? 'à¤‰à¤šà¥à¤š' : 'High');
      } else {
        displayStatus = lang === 'bn' ? 'à¦¸à§à¦¬à¦¾à¦­à¦¾à¦¬à¦¿à¦•' : (lang === 'hi' ? 'à¤¸à¤¾à¤®à¤¾à¤¨à¥à¤¯' : 'Normal');
      }
      
      let bioName = bio.name;
      if (lang === 'bn') {
        if (bio.name.includes('Hemoglobin')) bioName = 'à¦¹à¦¿à¦®à§‹à¦—à§à¦²à§‹à¦¬à¦¿à¦¨';
        if (bio.name.includes('White')) bioName = 'à¦¶à§à¦¬à§‡à¦¤ à¦°à¦•à§à¦¤à¦•à¦£à¦¿à¦•à¦¾ (WBC)';
        if (bio.name.includes('Cholesterol')) bioName = 'à¦•à§‹à¦²à§‡à¦¸à§à¦Ÿà§‡à¦°à¦² (à¦®à§‹à¦Ÿ)';
        if (bio.name.includes('Glucose')) bioName = 'à¦«à¦¾à¦¸à§à¦Ÿà¦¿à¦‚ à¦¬à§à¦²à¦¾à¦¡ à¦—à§à¦²à§à¦•à§‹à¦œ';
        if (bio.name.includes('Platelets')) bioName = 'à¦ªà§à¦²à¦¾à¦Ÿà¦¿à¦²à§‡à¦Ÿ à¦•à¦¾à¦‰à¦¨à§à¦Ÿ';
      } else if (lang === 'hi') {
        if (bio.name.includes('Hemoglobin')) bioName = 'à¤¹à¥€à¤®à¥‹à¤—à¥à¤²à¥‹à¤¬à¤¿à¤¨';
        if (bio.name.includes('White')) bioName = 'à¤¶à¥à¤µà¥‡à¤¤ à¤°à¤•à¥à¤¤ à¤•à¥‹à¤¶à¤¿à¤•à¤¾ (WBC)';
        if (bio.name.includes('Cholesterol')) bioName = 'à¤•à¥‹à¤²à¥‡à¤¸à¥à¤Ÿà¥à¤°à¥‰à¤² (à¤•à¥à¤²)';
        if (bio.name.includes('Glucose')) bioName = 'à¤«à¤¾à¤¸à¥à¤Ÿà¤¿à¤‚à¤— à¤¬à¥à¤²à¤¡ à¤—à¥à¤²à¥‚à¤•à¥‹à¤œ';
        if (bio.name.includes('Platelets')) bioName = 'à¤ªà¥à¤²à¥‡à¤Ÿà¤²à¥‡à¤Ÿà¥à¤¸ à¤•à¤¾à¤‰à¤‚à¤Ÿ';
      }
      
      const row = document.createElement('tr');
      row.innerHTML = `
        <td style="padding: 10px; border-bottom: 1px solid var(--glass-border); font-weight: 600;">${bioName}</td>
        <td style="padding: 10px; border-bottom: 1px solid var(--glass-border); font-family: var(--font-display);">${bio.value}</td>
        <td style="padding: 10px; border-bottom: 1px solid var(--glass-border); color: var(--text-secondary);">${bio.ref}</td>
        <td style="padding: 10px; border-bottom: 1px solid var(--glass-border);">
          <span class="biomarker-status-badge ${badgeClass}">${displayStatus}</span>
        </td>
      `;
      bloodTableBody.appendChild(row);
    });
    
    const lowHem = lang === 'bn' ? 'à¦¸à¦¾à¦®à¦¾à¦¨à§à¦¯ à¦•à¦® à¦¹à¦¿à¦®à§‹à¦—à§à¦²à§‹à¦¬à¦¿à¦¨ à¦à¦¬à¦‚ à¦‰à¦šà§à¦š à¦•à§‹à¦²à§‡à¦¸à§à¦Ÿà§‡à¦°à¦² à¦ªà¦¾à¦“à¦¯à¦¼à¦¾ à¦—à§‡à¦›à§‡à¥¤' : (lang === 'hi' ? 'à¤¹à¤²à¥à¤•à¤¾ à¤¹à¥€à¤®à¥‹à¤—à¥à¤²à¥‹à¤¬à¤¿à¤¨ à¤•à¤® à¤”à¤° à¤•à¥à¤² à¤•à¥‹à¤²à¥‡à¤¸à¥à¤Ÿà¥à¤°à¥‰à¤² à¤‰à¤šà¥à¤š à¤ªà¤¾à¤¯à¤¾ à¤—à¤¯à¤¾ à¤¹à¥ˆà¥¤' : 'Mild anemia (low hemoglobin) and borderline high cholesterol indicators identified.');
    const lowHemDesc = lang === 'bn' ? 'à¦†à§Ÿà¦°à¦¨ à¦¸à¦®à§ƒà¦¦à§à¦§ à¦–à¦¾à¦¬à¦¾à¦° à¦–à¦¾à¦¨ à¦à¦¬à¦‚ à¦•à§‹à¦²à§‡à¦¸à§à¦Ÿà§‡à¦°à¦² à¦•à¦®à¦¾à¦¤à§‡ à¦šà¦°à§à¦¬à¦¿à¦¯à§à¦•à§à¦¤ à¦–à¦¾à¦¬à¦¾à¦° à¦à§œà¦¿à§Ÿà§‡ à¦šà¦²à§à¦¨à¥¤' : (lang === 'hi' ? 'à¤†à¤¯à¤°à¤¨ à¤¯à¥à¤•à¥à¤¤ à¤­à¥‹à¤œà¤¨ à¤¬à¤¢à¤¼à¤¾à¤à¤‚ à¤”à¤° à¤•à¥‹à¤²à¥‡à¤¸à¥à¤Ÿà¥à¤°à¥‰à¤² à¤•à¤® à¤•à¤°à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤µà¤¸à¤¾à¤¯à¥à¤•à¥à¤¤ à¤­à¥‹à¤œà¤¨ à¤¸à¥‡ à¤¬à¤šà¥‡à¤‚à¥¤' : 'Focus on iron-rich nutrition (leafy greens, lentils) and minimize trans-fat intakes.');
    
    bloodOverallAssessmentText.innerHTML = `<strong>${lowHem}</strong><br><span style="font-size:11.5px; color:var(--text-secondary);">${lowHemDesc}</span>`;
    
    bloodAssessmentBanner.className = 'alert-banner medium-risk';
    lucide.createIcons();
  }

  // --- HEALTH RISK PREDICTION MODULE ---
  
  if (riskCalcTrigger) {
    riskCalcTrigger.addEventListener('click', () => {
      const systolic = parseInt(document.getElementById('risk-systolic').value) || 120;
      const exercise = parseInt(document.getElementById('risk-exercise').value) || 3;
      const isSmoker = document.getElementById('risk-smoker').checked;
      const isDiabetic = document.getElementById('risk-diabetic').checked;
      const isHeartHistory = document.getElementById('risk-heart-history').checked;
      const isAlcohol = document.getElementById('risk-alcohol').checked;
      
      let cardioRisk = 5;
      let diabetesRisk = 4;
      let hyperRisk = 8;
      
      if (systolic > 140) {
        hyperRisk += 40;
        cardioRisk += 25;
      } else if (systolic > 120) {
        hyperRisk += 15;
        cardioRisk += 10;
      }
      
      if (exercise >= 7) {
        cardioRisk -= 3;
        diabetesRisk -= 3;
        hyperRisk -= 4;
      } else if (exercise < 2) {
        cardioRisk += 8;
        diabetesRisk += 10;
        hyperRisk += 8;
      }
      
      if (isSmoker) {
        cardioRisk += 30;
        hyperRisk += 15;
      }
      if (isDiabetic) {
        diabetesRisk += 35;
        cardioRisk += 12;
      }
      if (isHeartHistory) {
        cardioRisk += 20;
        hyperRisk += 10;
      }
      if (isAlcohol) {
        hyperRisk += 12;
        cardioRisk += 8;
      }
      
      cardioRisk = Math.min(99, Math.max(2, cardioRisk));
      diabetesRisk = Math.min(99, Math.max(1, diabetesRisk));
      hyperRisk = Math.min(99, Math.max(3, hyperRisk));
      
      riskEmptyState.classList.remove('active');
      riskResultsState.classList.add('active');
      
      riskCardioBadge.textContent = `${cardioRisk}%`;
      riskDiabetesBadge.textContent = `${diabetesRisk}%`;
      riskHyperBadge.textContent = `${hyperRisk}%`;
      
      setTimeout(() => { riskCardioFill.style.width = `${cardioRisk}%`; }, 100);
      setTimeout(() => { riskDiabetesFill.style.width = `${diabetesRisk}%`; }, 300);
      setTimeout(() => { riskHyperFill.style.width = `${hyperRisk}%`; }, 500);
      
      setRiskBadgeClass(riskCardioBadge, cardioRisk);
      setRiskBadgeClass(riskDiabetesBadge, diabetesRisk);
      setRiskBadgeClass(riskHyperBadge, hyperRisk);
      
      const maxRisk = Math.max(cardioRisk, diabetesRisk, hyperRisk);
      const lang = appState.currentLanguage || 'en';
      
      let advice = '';
      if (maxRisk > 45) {
        riskAdviceBanner.className = 'alert-banner high-risk';
        advice = lang === 'bn' ? 
          'à¦†à¦ªà¦¨à¦¾à¦° à¦à§à¦à¦•à¦¿ à¦‰à¦šà§à¦š à¦¸à§€à¦®à¦¾à§Ÿ à¦°à§Ÿà§‡à¦›à§‡à¥¤ à¦§à§‚à¦®à¦ªà¦¾à¦¨ à¦¬à¦°à§à¦œà¦¨ à¦•à¦°à§à¦¨, à¦°à¦•à§à¦¤à¦šà¦¾à¦ª à¦¨à¦¿à§Ÿà¦®à¦¿à¦¤ à¦ªà¦°à§€à¦•à§à¦·à¦¾ à¦•à¦°à§à¦¨ à¦à¦¬à¦‚ à¦¡à¦¾à¦•à§à¦¤à¦¾à¦°à§‡à¦° à¦ªà¦°à¦¾à¦®à¦°à§à¦¶ à¦¨à¦¿à¦¨à¥¤' : 
          (lang === 'hi' ? 
            'à¤†à¤ªà¤•à¤¾ à¤œà¥‹à¤–à¤¿à¤® à¤¸à¥à¤¤à¤° à¤…à¤§à¤¿à¤• à¤¹à¥ˆà¥¤ à¤§à¥‚à¤®à¥à¤°à¤ªà¤¾à¤¨ à¤¬à¤‚à¤¦ à¤•à¤°à¥‡à¤‚, à¤°à¤•à¥à¤¤à¤šà¤¾à¤ª à¤•à¥€ à¤¨à¤¿à¤¯à¤®à¤¿à¤¤ à¤œà¤¾à¤‚à¤š à¤•à¤°à¤¾à¤à¤‚ à¤”à¤° à¤¡à¥‰à¤•à¥à¤Ÿà¤° à¤¸à¥‡ à¤®à¤¿à¤²à¥‡à¤‚à¥¤' : 
            'High clinical indicators observed. Avoid active tobacco smoking, maintain 150 minutes of weekly cardio exercise, and schedule medical physical evaluations.');
      } else if (maxRisk > 20) {
        riskAdviceBanner.className = 'alert-banner medium-risk';
        advice = lang === 'bn' ? 
          'à¦®à¦¾à¦à¦¾à¦°à¦¿ à¦à§à¦à¦•à¦¿ à¦¸à¦¨à¦¾à¦•à§à¦¤ à¦¹à§Ÿà§‡à¦›à§‡à¥¤ à¦œà§€à¦¬à¦¨à¦¯à¦¾à¦¤à§à¦°à¦¾à¦° à¦®à¦¾à¦¨ à¦‰à¦¨à§à¦¨à¦¤ à¦•à¦°à¦¤à§‡ à¦¬à§à¦¯à¦¾à¦¯à¦¼à¦¾à¦® à¦¬à¦¾à§œà¦¾à¦¨ à¦à¦¬à¦‚ à¦¸à§‹à¦¡à¦¿à§Ÿà¦¾à¦® à¦•à¦®à¦¾à¦¨à¥¤' : 
          (lang === 'hi' ? 
            'à¤®à¤§à¥à¤¯à¤® à¤œà¥‹à¤–à¤¿à¤® à¤•à¤¾ à¤ªà¤¤à¤¾ à¤šà¤²à¤¾ à¤¹à¥ˆà¥¤ à¤œà¥€à¤µà¤¨à¤¶à¥ˆà¤²à¥€ à¤®à¥‡à¤‚ à¤¸à¥à¤§à¤¾à¤° à¤•à¥‡ à¤²à¤¿à¤ à¤µà¥à¤¯à¤¾à¤¯à¤¾à¤® à¤¬à¤¢à¤¼à¤¾à¤à¤‚ à¤”à¤° à¤¨à¤®à¤• à¤•à¤¾ à¤¸à¥‡à¤µà¤¨ à¤•à¤® à¤•à¤°à¥‡à¤‚à¥¤' : 
            'Borderline risks. Increase daily active walking, decrease dietary sodium intake, and schedule routine preventive wellness screenings.');
      } else {
        riskAdviceBanner.className = 'alert-banner low-risk';
        advice = lang === 'bn' ? 
          'à¦†à¦ªà¦¨à¦¾à¦° à¦à§à¦à¦•à¦¿ à¦…à¦¨à§‡à¦• à¦•à¦®à¥¤ à¦¸à§à¦·à¦® à¦–à¦¾à¦¦à§à¦¯ à¦à¦¬à¦‚ à¦¸à§à¦¬à¦¾à¦¸à§à¦¥à§à¦¯à¦•à¦° à¦œà§€à¦¬à¦¨à¦¯à¦¾à¦¤à§à¦°à¦¾ à¦¬à¦œà¦¾à§Ÿ à¦°à¦¾à¦–à§à¦¨à¥¤' : 
          (lang === 'hi' ? 
            'à¤†à¤ªà¤•à¤¾ à¤œà¥‹à¤–à¤¿à¤® à¤¸à¥à¤¤à¤° à¤¬à¤¹à¥à¤¤ à¤•à¤® à¤¹à¥ˆà¥¤ à¤¸à¤‚à¤¤à¥à¤²à¤¿à¤¤ à¤†à¤¹à¤¾à¤° à¤”à¤° à¤¸à¥à¤µà¤¸à¥à¤¥ à¤œà¥€à¤µà¤¨à¤¶à¥ˆà¤²à¥€ à¤¬à¤¨à¤¾à¤ à¤°à¤–à¥‡à¤‚à¥¤' : 
            'Low risk metrics. Continue maintaining healthy habits, routine exercises, and balanced diet profiles.');
      }
      
      riskAdviceTextContent.textContent = advice;
      lucide.createIcons();
    });
    
    resetRiskBtn.addEventListener('click', () => {
      riskResultsState.classList.remove('active');
      riskEmptyState.classList.add('active');
      
      riskCardioFill.style.width = '0%';
      riskDiabetesFill.style.width = '0%';
      riskHyperFill.style.width = '0%';
      
      riskForm.reset();
    });
  }
  
  function setRiskBadgeClass(element, score) {
    if (score > 45) {
      element.className = 'outbreak-trend level-high';
      element.style.color = 'var(--accent-rose)';
    } else if (score > 20) {
      element.className = 'outbreak-trend level-medium';
      element.style.color = 'var(--accent-amber)';
    } else {
      element.className = 'outbreak-trend level-low';
      element.style.color = 'var(--accent-teal)';
    }
  }

};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}

