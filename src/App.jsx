import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, onSnapshot, setLogLevel } from 'firebase/firestore';
import { 
  Heart, 
  Droplet, 
  CalendarDays, 
  Baby, 
  Brain, 
  Utensils, 
  AlertTriangle, 
  CheckCircle, 
  ChevronRight, 
  Loader2, 
  User, 
  Smile, 
  Frown, 
  Meh,
  Share2,
  X,
  Stethoscope,
  Apple,
  Phone,
  ArrowLeft,
  BookOpen,
  HelpCircle,
  Languages
} from 'lucide-react';

// --- Firebase Configuration ---
// These globals are provided by the environment.
// ** FOR VS CODE: Replace this with your actual Firebase config object **
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { 
      apiKey: "AIzaSyBD-Hp6V6BytxVloR3aUNWuF7v-BeNqw_g", 
      authDomain: "mycyclecareapp.firebaseapp.com", 
      projectId: "mycyclecareapp",
      storageBucket: "mycyclecareapp.firebasestorage.app",
      messagingSenderId: "729902625190",
      appId: "1:729902625190:web:51c449b50f036dc705df67"
    };

// ** FOR VS CODE: You can hardcode this or use environment variables **
const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const appId = rawAppId.replace(/\//g, '_'); // Replace slashes to create a valid Firestore path segment

// --- Gemini API Configuration ---
// ** FOR VS CODE: Replace "" with your actual Gemini API Key **
const apiKey = ""; // Or use import.meta.env.VITE_GEMINI_API_KEY
const GEMINI_API_URL = `https://generativanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

// --- Utility Functions ---
const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const formatDate = (date) => {
  if (!date) return 'N/A';
  // Ensures date is a Date object, even if it's a string
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'Invalid Date';
  return d.toISOString().split('T')[0];
};

const getDaysDiff = (date1, date2) => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Simple date formatter for display
const prettyFormatDate = (dateStr) => {
  if (!dateStr || isNaN(new Date(dateStr).getTime())) {
    return 'N/A';
  }
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(dateStr).toLocaleDateString(undefined, options);
};

// --- Cycle Calculation Logic ---
const calculateCycleData = (userData) => {
  if (!userData || !userData.lastPeriodDate || !userData.cycleLength || !userData.periodLength) {
    return null;
  }

  const { lastPeriodDate, cycleLength, periodLength } = userData;
  const lastPeriod = new Date(lastPeriodDate);
  
  if (isNaN(lastPeriod.getTime())) {
    return null;
  }

  const nextPeriodDate = addDays(lastPeriod, cycleLength);
  const periodEndDate = addDays(lastPeriod, periodLength);
  
  // Ovulation is typically ~14 days *before* the *next* period
  const ovulationDate = addDays(nextPeriodDate, -14);
  
  // Fertile window is ~5 days before ovulation + ovulation day
  const fertileStart = addDays(ovulationDate, -5);
  const fertileEnd = ovulationDate;

  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize today's date

  const currentDayOfCycle = getDaysDiff(lastPeriod, today) + 1;
  const isPeriod = today >= lastPeriod && today < periodEndDate;
  const isFertile = today >= fertileStart && today <= fertileEnd;

  // --- New Fertility Level Logic ---
  const ovDay = new Date(ovulationDate);
  ovDay.setHours(0, 0, 0, 0);
  const ovTime = ovDay.getTime();
  const todayTime = today.getTime(); // today is already normalized
  
  let fertilityLevel = 'Low';
  if (todayTime === ovTime || todayTime === addDays(ovDay, -1).getTime() || todayTime === addDays(ovDay, -2).getTime()) {
    fertilityLevel = 'High';
  } else if (todayTime === addDays(ovDay, -3).getTime() || todayTime === addDays(ovDay, -4).getTime() || todayTime === addDays(ovDay, -5).getTime()) {
    fertilityLevel = 'Medium';
  }
  // --- End New Logic ---

  return {
    nextPeriodDate: formatDate(nextPeriodDate),
    periodEndDate: formatDate(periodEndDate),
    ovulationDate: formatDate(ovulationDate),
    fertileStart: formatDate(fertileStart),
    fertileEnd: formatDate(fertileEnd),
    currentDayOfCycle,
    isPeriod,
    isFertile, // Still needed for Calendar and Share modal
    fertilityLevel, // Added new property
    cycleLength,
    periodLength
  };
};

const calculatePregnancyWeek = (dueDate) => {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (isNaN(due.getTime())) return null;
  // Pregnancy is 40 weeks (280 days)
  const conceptionEstimate = addDays(due, -280);
  const today = new Date();
  const daysPregnant = getDaysDiff(conceptionEstimate, today);
  const week = Math.ceil(daysPregnant / 7);
  const days = daysPregnant % 7;
  return { week, days };
};

// --- Firebase Initialization ---
let db, auth;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  setLogLevel('Debug'); // For detailed console logs
} catch (e) {
  console.error("Error initializing Firebase:", e);
}

// --- Main App Component ---
export default function App() {
  const [userData, setUserData] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    if (!auth) {
      setAuthError("Firebase Auth failed to initialize.");
      setIsLoading(false);
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
        // User is signed in, set up data listener
        const userDocRef = doc(db, 'artifacts', appId, 'users', user.uid, 'userData', 'profile');
        
        const unsubscribeSnapshot = onSnapshot(userDocRef, (doc) => {
          if (doc.exists()) {
            setUserData(doc.data());
          } else {
            // New user, no data yet. Onboarding will create it.
            setUserData({ onboarded: false }); 
          }
          setIsLoading(false);
        }, (error) => {
          console.error("Error listening to user data:", error);
          setAuthError("Could not fetch user data.");
          setIsLoading(false);
        });

        return () => unsubscribeSnapshot(); // Cleanup snapshot listener

      } else {
        // No user, attempt to sign in
        try {
          // ** FOR VS CODE: __initial_auth_token__ won't exist. Sign in anonymously. **
          if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
          } else {
            await signInAnonymously(auth);
          }
          // onAuthStateChanged will run again with the new user
        } catch (error) {
          console.error("Error signing in:", error);
          setAuthError("Authentication failed. Please refresh.");
          setIsLoading(false);
        }
      }
    });

    return () => unsubscribeAuth(); // Cleanup auth listener
  }, []);

  // Main render logic
  const renderContent = () => {
    if (isLoading) {
      return <LoadingScreen message="Connecting to your wellness hub..." />;
    }
    
    if (authError) {
      return <ErrorScreen message={authError} />;
    }

    if (!userId) {
      return <LoadingScreen message="Authenticating..." />;
    }

    if (!userData || !userData.onboarded) {
      return <OnboardingScreen userId={userId} />;
    }

    if (userData.isPregnant) {
      return <PregnancyMode userData={userData} userId={userId} />;
    }

    return <MainApp userData={userData} userId={userId} />;
  };

  // The animation styles are now in tailwind.config.js, so we remove them from here.

  return (
    <div className="antialiased bg-gray-50 text-gray-800 min-h-screen font-sans">
      <div className="max-w-md mx-auto bg-white min-h-screen shadow-lg">
        {renderContent()}
      </div>
    </div>
  );
}

// --- Loading and Error Components ---
function LoadingScreen({ message }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
      <Loader2 className="w-12 h-12 text-pink-500 animate-spin" />
      <p className="mt-4 text-lg font-semibold text-gray-700">{message}</p>
    </div>
  );
}

function ErrorScreen({ message }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
      <AlertTriangle className="w-12 h-12 text-red-500" />
      <h2 className="mt-4 text-xl font-bold text-red-700">An Error Occurred</h2>
      <p className="mt-1 text-gray-600">{message}</p>
    </div>
  );
}

// --- Onboarding Component ---
function OnboardingScreen({ userId }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    age: '',
    gender: 'female',
    lastPeriodDate: '',
    cycleLength: '28',
    periodLength: '5',
    isPregnant: false,
    pregnancyDueDate: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null); // Add error state

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const nextStep = () => {
    // Basic validation
    if (step === 1 && !formData.age) return;
    if (step === 2 && (!formData.lastPeriodDate || !formData.cycleLength || !formData.periodLength)) return;
    setStep(s => s + 1);
  };
  
  const prevStep = () => setStep(s => s - 1);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    const userDocRef = doc(db, 'artifacts', appId, 'users', userId, 'userData', 'profile');
    
    const dataToSave = {
      ...formData,
      age: parseInt(formData.age, 10),
      cycleLength: parseInt(formData.cycleLength, 10),
      periodLength: parseInt(formData.periodLength, 10),
      onboarded: true,
      symptomsLog: [] // Initialize empty log
    };

    try {
      await setDoc(userDocRef, dataToSave);
      // No need to call setUserData(dataToSave), onSnapshot will do it.
    } catch (error) {
      console.error("Error saving onboarding data:", error);
      setSubmitError("Could not save your information. Please try again."); // Set error state
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 pt-12 min-h-screen relative">
      <button className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 text-gray-600" title="Change Language">
        <Languages className="w-6 h-6" />
      </button>
      <h1 className="text-3xl font-bold text-pink-600">Welcome to Kasturi</h1>
      <p className="text-lg text-gray-600 mb-8">Let's get to know you.</p>

      {/* Step 1: Age & Gender */}
      {step === 1 && (
        <div className="animate-slide-in">
          <label htmlFor="age" className="block text-sm font-medium text-gray-700 mb-1">How old are you?</label>
          <input
            type="number"
            id="age"
            name="age"
            value={formData.age}
            onChange={handleChange}
            className="w-full p-3 border border-gray-300 rounded-lg shadow-sm"
            placeholder="e.g., 25"
          />
          <button onClick={nextStep} className="w-full mt-6 bg-pink-600 text-white font-bold py-3 px-4 rounded-lg shadow hover:bg-pink-700 transition">
            Next
          </button>
        </div>
      )}

      {/* Step 2: Cycle Info */}
      {step === 2 && (
        <div className="animate-slide-in">
          <div className="mb-4">
            <label htmlFor="lastPeriodDate" className="block text-sm font-medium text-gray-700 mb-1">First day of your last period?</label>
            <input
              type="date"
              id="lastPeriodDate"
              name="lastPeriodDate"
              value={formData.lastPeriodDate}
              onChange={handleChange}
              className="w-full p-3 border border-gray-300 rounded-lg shadow-sm"
            />
          </div>
          <div className="mb-4">
            <label htmlFor="cycleLength" className="block text-sm font-medium text-gray-700 mb-1">Average cycle length (days)?</label>
            <input
              type="number"
              id="cycleLength"
              name="cycleLength"
              value={formData.cycleLength}
              onChange={handleChange}
              className="w-full p-3 border border-gray-300 rounded-lg shadow-sm"
            />
          </div>
          <div className="mb-4">
            <label htmlFor="periodLength" className="block text-sm font-medium text-gray-700 mb-1">Average period length (days)?</label>
            <input
              type="number"
              id="periodLength"
              name="periodLength"
              value={formData.periodLength}
              onChange={handleChange}
              className="w-full p-3 border border-gray-300 rounded-lg shadow-sm"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={prevStep} className="w-1/2 mt-4 bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-lg hover:bg-gray-300 transition">
              Back
            </button>
            <button onClick={nextStep} className="w-1/2 mt-4 bg-pink-600 text-white font-bold py-3 px-4 rounded-lg shadow hover:bg-pink-700 transition">
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Pregnancy Status */}
      {step === 3 && (
        <div className="animate-slide-in">
          <div className="flex items-center mb-4">
            <input
              type="checkbox"
              id="isPregnant"
              name="isPregnant"
              checked={formData.isPregnant}
              onChange={handleChange}
              className="h-4 w-4 text-pink-600 border-gray-300 rounded focus:ring-pink-500"
            />
            <label htmlFor="isPregnant" className="ml-2 block text-sm font-medium text-gray-900">Are you currently pregnant?</label>
          </div>
          
          {formData.isPregnant && (
            <div className="mb-4">
              <label htmlFor="pregnancyDueDate" className="block text-sm font-medium text-gray-700 mb-1">Estimated due date?</label>
              <input
                type="date"
                id="pregnancyDueDate"
                name="pregnancyDueDate"
                value={formData.pregnancyDueDate}
                onChange={handleChange}
                className="w-full p-3 border border-gray-300 rounded-lg shadow-sm"
              />
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={prevStep} className="w-1/2 mt-4 bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-lg hover:bg-gray-300 transition">
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="w-1/2 mt-4 bg-pink-600 text-white font-bold py-3 px-4 rounded-lg shadow hover:bg-pink-700 transition disabled:opacity-50 flex items-center justify-center"
            >
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Finish Setup"}
            </button>
          </div>
          {submitError && (
            <p className="mt-4 text-center text-red-600">{submitError}</p>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main App (Non-Pregnant) ---
function MainApp({ userData, userId }) {
  const [nav, setNav] = useState('today'); // today, calendar, sangini
  const [showShareModal, setShowShareModal] = useState(false);
  
  const cycleData = useMemo(() => calculateCycleData(userData), [userData]);

  if (!cycleData) {
    return (
      <ErrorScreen message="Could not calculate cycle data. Please check your profile settings." />
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="flex justify-between items-center p-4 border-b border-gray-200">
        <h1 className="text-2xl font-bold text-pink-600">Kasturi</h1>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowShareModal(true)} 
            className="p-2 rounded-full hover:bg-gray-100"
            title="Share Summary"
          >
            <Share2 className="w-6 h-6 text-pink-600" />
          </button>
          <button className="p-2 rounded-full hover:bg-gray-100 text-gray-600" title="Change Language">
            <Languages className="w-6 h-6" />
          </button>
        </div>
      </header>
      
      <main className="flex-grow p-4">
        {nav === 'today' && <TodayView cycleData={cycleData} userData={userData} userId={userId} />}
        {nav === 'calendar' && <CalendarView cycleData={cycleData} />}
        {nav === 'sangini' && <InsightsView />}
      </main>

      <nav className="grid grid-cols-3 gap-1 p-2 bg-white border-t border-gray-200 sticky bottom-0">
        <NavButton icon={Heart} label="Today" active={nav === 'today'} onClick={() => setNav('today')} />
        <NavButton icon={CalendarDays} label="Calendar" active={nav === 'calendar'} onClick={() => setNav('calendar')} />
        <NavButton icon={Stethoscope} label="Sangini" active={nav === 'sangini'} onClick={() => setNav('sangini')} />
      </nav>

      {showShareModal && (
        <ShareModal 
          userData={userData} 
          cycleData={cycleData}
          onClose={() => setShowShareModal(false)} 
        />
      )}
    </div>
  );
}

const NavButton = ({ icon: Icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center justify-center p-2 rounded-lg transition ${
      active ? 'bg-pink-50 text-pink-600' : 'text-gray-500 hover:bg-gray-50'
    }`}
  >
    <Icon className="w-6 h-6" />
    <span className="text-xs font-medium">{label}</span>
  </button>
);

// --- Main App: Today View ---
function TodayView({ cycleData, userData, userId }) {
  const { currentDayOfCycle, isPeriod, nextPeriodDate, fertilityLevel } = cycleData;
  
  let status = "Cycle Day";
  let statusColor = "text-gray-800";
  
  if (isPeriod) {
    status = "Period";
    statusColor = "text-red-600";
  } else if (fertilityLevel === 'High') {
    status = "High Fertility";
    statusColor = "text-green-600";
  } else if (fertilityLevel === 'Medium') {
    status = "Medium Fertility";
    statusColor = "text-yellow-600";
  }

  // Determine color for the info card
  let fertilityColor = "text-gray-600";
  if (fertilityLevel === 'High') {
    fertilityColor = "text-green-600";
  } else if (fertilityLevel === 'Medium') {
    fertilityColor = "text-yellow-600";
  }

  return (
    <div className="animate-slide-in">
      <div className="relative p-6 bg-pink-50 rounded-lg text-center shadow-md overflow-hidden">
        <div className="relative z-10">
          <p className="text-sm font-medium text-pink-700 uppercase">{status}</p>
          <p className="text-6xl font-bold text-pink-900">{currentDayOfCycle}</p>
          <p className={`mt-2 text-lg font-medium ${statusColor}`}>{status}</p>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-4 mt-6">
        <InfoCard title="Fertility Today" value={fertilityLevel} statusColor={fertilityColor} />
        <InfoCard title="Next Period" value={prettyFormatDate(nextPeriodDate)} />
      </div>

      <SymptomLogger userData={userData} userId={userId} />
    </div>
  );
}

const InfoCard = ({ title, value, statusColor = 'text-gray-800' }) => (
  <div className="bg-white p-4 rounded-lg shadow text-center">
    <h3 className="text-sm font-medium text-gray-500">{title}</h3>
    <p className={`text-xl font-bold ${statusColor}`}>{value}</p>
  </div>
);

// --- Static Symptom Info ---
const symptomInfo = {
  Cramps: {
    reason: "During your period, your uterus contracts to shed its lining. These contractions can cause cramping.",
    remedies: [
      "Try a heating pad or hot water bottle on your abdomen.",
      "Gentle exercise like walking or stretching can help.",
      "Sip on warm chamomile tea or ginger tea.",
      "Stay hydrated and avoid salty foods, which can cause bloating."
    ]
  },
  Headache: {
    reason: "Hormone changes (especially the drop in estrogen) right before or during your period are a common trigger for headaches.",
    remedies: [
      "Make sure you are drinking enough water.",
      "Rest in a quiet, dark room if possible.",
      "A cool cloth on your forehead can provide relief.",
      "Try to maintain a regular sleep schedule."
    ]
  },
  Bloating: {
    reason: "Hormonal changes can cause your body to retain more water and salt, leading to that 'puffy' feeling.",
    remedies: [
      "Drink plenty of water (it sounds counterintuitive, but it helps).",
      "Reduce your salt (sodium) intake.",
      "Eat potassium-rich foods like bananas or avocados.",
      "Avoid carbonated drinks and gas-producing foods."
    ]
  },
  Acne: {
    reason: "Your hormones (like testosterone) can fluctuate, causing your skin's oil glands to work overtime, leading to breakouts.",
    remedies: [
      "Be extra-gentle with your skincare routine; don't scrub.",
      "Use a gentle, non-comedogenic cleanser.",
      "Try to avoid touching your face.",
      "Change your pillowcase regularly."
    ]
  },
  Tiredness: {
    reason: "Fluctuating hormones, trouble sleeping due to other symptoms (like cramps), and low iron levels can all contribute to fatigue.",
    remedies: [
      "Aim for 7-9 hours of sleep.",
      "Eat iron-rich foods like leafy greens, beans, and lean meat.",
      "Try gentle exercise to boost your energy levels.",
      "Take short naps if you need to."
    ]
  }
};

// --- Symptom Logger Component ---
function SymptomLogger({ userData, userId }) {
  const [todayLog, setTodayLog] = useState({ date: '', symptoms: [], mood: '', cravings: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // '', 'saving', 'saved', 'failed'
  
  const [selectedSymptom, setSelectedSymptom] = useState(null); // For showing info
  const [cravingResponse, setCravingResponse] = useState('');
  
  const todayStr = formatDate(new Date());

  // Find today's log from userData
  useEffect(() => {
    const existingLog = userData.symptomsLog?.find(log => log.date === todayStr);
    if (existingLog) {
      setTodayLog(existingLog);
      // Don't auto-fetch craving info on load, only on new click
      // But if there was a craving, set the response
      if (existingLog.cravings) {
        handleCravingSelect(existingLog.cravings, true); // true to skip logging
      }
    } else {
      setTodayLog({ date: todayStr, symptoms: [], mood: '', cravings: '' });
    }
  }, [userData, todayStr]);

  const handleSymptomToggle = (symptom) => {
    // Toggle the symptom info
    if (selectedSymptom === symptom) {
      setSelectedSymptom(null);
    } else {
      setSelectedSymptom(symptom);
    }
    
    // Toggle the symptom in the log
    setTodayLog(prev => {
      const symptoms = prev.symptoms.includes(symptom)
        ? prev.symptoms.filter(s => s !== symptom)
        : [...prev.symptoms, symptom];
      return { ...prev, symptoms };
    });
  };

  const handleMoodSelect = (mood) => {
    setTodayLog(prev => ({ ...prev, mood }));
  };

  const handleCravingSelect = (cravingType, skipLog = false) => {
    if (!skipLog) {
      setTodayLog(prev => ({ ...prev, cravings: cravingType }));
    }
    
    let response = '';
    switch (cravingType) {
      case 'Sweet':
        response = `
• **Fruits:** A great source of natural sugars, fiber, and vitamins.
• **Dark Chocolate (70%+):** Contains magnesium, which can help with period symptoms.
• **Yogurt with Berries:** Provides protein and calcium, and the berries add natural sweetness.
        `;
        break;
      case 'Sour':
        response = `
• **Roasted Makhana (Fox Nuts):** A light, crunchy snack. Try with a sprinkle of amchur (dry mango powder).
• **Sprouts Chaat:** A nutrient-dense salad with moong sprouts, veggies, and a dash of lemon juice.
        `;
        break;
      case 'Spicy':
        response = `
• **Warm Vegetable Soup:** Hydrating, comforting, and packed with nutrients.
• **Moong Dal Chilla:** A savory pancake made from lentils, it's high in protein and easy to digest.
        `;
        break;
      default:
        response = "Please select a craving type to see suggestions.";
    }
    
    setCravingResponse(response.trim());
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('saving');
    
    const userDocRef = doc(db, 'artifacts', appId, 'users', userId, 'userData', 'profile');
    
    // Get current logs, filter out today's log if it exists, then add the new one
    const newLogs = (userData.symptomsLog || []).filter(log => log.date !== todayStr);
    newLogs.push(todayLog);
    
    try {
      await updateDoc(userDocRef, {
        symptomsLog: newLogs
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2000); // Clear message
    } catch (error) {
      console.error("Error saving log:", error);
      setSaveStatus('failed');
      setTimeout(() => setSaveStatus(''), 2000); // Clear message
    } finally {
      setIsSaving(false);
    }
  };

  const symptomsList = ['Cramps', 'Headache', 'Bloating', 'Acne', 'Tiredness'];
  const moods = [
    { name: 'Happy', icon: Smile },
    { name: 'Sad', icon: Frown },
    { name: 'Okay', icon: Meh },
  ];
  const cravingTypes = ['Sweet', 'Sour', 'Spicy'];

  return (
    <div className="mt-6 bg-white p-4 rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-3">How are you feeling today?</h3>
      
      {/* Symptoms Section */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Symptoms</label>
        <div className="flex flex-wrap gap-2">
          {symptomsList.map(symptom => (
            <SymptomButton 
              key={symptom}
              label={symptom} 
              active={todayLog.symptoms.includes(symptom)} 
              onClick={() => handleSymptomToggle(symptom)} 
            />
          ))}
        </div>
        
        {selectedSymptom && symptomInfo[selectedSymptom] && (
          <div className="mt-3 p-3 bg-pink-50 border border-pink-200 rounded-lg animate-slide-in">
            <h4 className="font-semibold text-pink-800">{selectedSymptom} Info:</h4>
            <p className="text-sm text-pink-900 mt-1">{symptomInfo[selectedSymptom].reason}</p>
            <ul className="list-disc list-inside text-sm text-pink-900 mt-2 space-y-1">
              {symptomInfo[selectedSymptom].remedies.map((remedy, i) => (
                <li key={i}>{remedy}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Moods Section */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Mood</label>
        <div className="flex bg-gray-100 rounded-lg p-1">
          {moods.map(mood => (
            <MoodButton 
              key={mood.name}
              icon={mood.icon}
              label={mood.name} 
              active={todayLog.mood === mood.name} 
              onClick={() => handleMoodSelect(mood.name)} 
            />
          ))}
        </div>
      </div>
      
      {/* Cravings Section */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Cravings</label>
        <div className="flex flex-wrap gap-2">
          {cravingTypes.map(craving => (
            <SymptomButton 
              key={craving}
              label={craving} 
              active={todayLog.cravings === craving} 
              onClick={() => handleCravingSelect(craving)} 
            />
          ))}
        </div>
        
        {cravingResponse && (
          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg animate-slide-in">
            <h4 className="font-semibold text-green-800">Healthy Swaps for "{todayLog.cravings}" Cravings:</h4>
            <div className="text-sm text-green-900 whitespace-pre-wrap mt-1" 
                 dangerouslySetInnerHTML={{ __html: cravingResponse.replace(/•/g, '•&nbsp;') }} />
          </div>
        )}
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full bg-pink-600 text-white font-bold py-3 px-4 rounded-lg shadow hover:bg-pink-700 transition disabled:opacity-50 flex items-center justify-center"
      >
        {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save Today's Log"}
      </button>
      {saveStatus === 'saved' && (
        <p className="text-center text-sm text-green-600 mt-2">Log saved successfully!</p>
      )}
      {saveStatus === 'failed' && (
        <p className="text-center text-sm text-red-600 mt-2">Could not save log. Please try again.</p>
      )}
    </div>
  );
}

const SymptomButton = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
      active
        ? 'bg-pink-100 text-pink-800 border-pink-300'
        : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
    }`}
  >
    {label}
  </button>
);

const MoodButton = ({ icon: Icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center p-2 rounded-lg w-1/3 transition ${
      active ? 'bg-pink-100 text-pink-800' : 'text-gray-600 hover:bg-gray-100'
    }`}
  >
    <Icon className="w-7 h-7" />
    <span className="text-sm font-medium">{label}</span>
  </button>
);


// --- Main App: Calendar View ---
function CalendarView({ cycleData }) {
  const { nextPeriodDate, fertileStart, fertileEnd, ovulationDate } = cycleData;

  const events = [
    { date: fertileStart, end: fertileEnd, name: 'Fertile Window', icon: Heart, color: 'bg-green-100 text-green-800' },
    { date: ovulationDate, name: 'Est. Ovulation', icon: CheckCircle, color: 'bg-blue-100 text-blue-800' },
    { date: nextPeriodDate, name: 'Next Period Starts', icon: Droplet, color: 'bg-red-100 text-red-800' },
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  return (
    <div className="animate-slide-in">
      <h2 className="text-xl font-semibold mb-4">Your Cycle Forecast</h2>
      <div className="space-y-3">
        {events.map((event) => (
          <div key={event.name} className={`flex items-center p-4 rounded-lg shadow ${event.color}`}>
            <event.icon className="w-6 h-6 mr-3 flex-shrink-0" />
            <div>
              <h3 className="font-semibold">{event.name}</h3>
              <p className="text-sm">
                {prettyFormatDate(event.date)}
                {event.end && ` - ${prettyFormatDate(event.end)}`}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-gray-600 text-center">
        *Estimates are based on your average cycle length.
      </p>
    </div>
  );
}

// --- Main App: Insights View (Gemini) ---
function InsightsView() {
  return (
    <div className="animate-slide-in">
      <h2 className="text-xl font-semibold mb-4">Sangini</h2>
      <SymptomAnalyzer />
    </div>
  );
}

// --- Gemini API Call Function ---
// This function is also used by AskQuery
const callGemini = async (systemPrompt, userQuery, retries = 3, delay = 1000) => {
  const payload = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [{ parts: [{ text: userQuery }] }],
  };

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && retries > 0) {
        console.warn(`API call failed with status ${response.status}. Retrying in ${delay}ms...`);
        await new Promise(res => setTimeout(res, delay));
        return callGemini(systemPrompt, userQuery, retries - 1, delay * 2);
      }
      throw new Error(`API Error: ${response.statusText} (Status: ${response.status})`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      throw new Error("Invalid response structure from API.");
    }
    return text;

  } catch (error) {
    console.error("Gemini API call failed:", error);
    return `Error: Could not get insights. ${error.message}`;
  }
};

// --- Symptom Analyzer ---
function SymptomAnalyzer() {
  const [symptoms, setSymptoms] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    if (!symptoms) return;
    setIsLoading(true);
    setAiResponse('');
    
    const systemPrompt = "You are a health assistant in a period tracking app. A user is describing their symptoms. Provide a brief, supportive, and informative general overview of what *could* be related to these symptoms (e.g., 'This can sometimes be related to hormonal changes...'). **CRITICAL:** Do NOT provide a diagnosis. Your primary goal is to validate their concern and strongly urge them to see a doctor. Keep the response to 2-3 short paragraphs.";
    
    const userQuery = `My symptoms are: "${symptoms}". What could this be related to?`;
    
    const response = await callGemini(systemPrompt, userQuery);
    setAiResponse(response);
    setIsLoading(false);
  };

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        Describe any unusual or severe symptoms. This tool provides general information, not a medical diagnosis.
      </p>
      <textarea
        value={symptoms}
        onChange={(e) => setSymptoms(e.target.value)}
        className="w-full p-2 h-24 border border-gray-300 rounded-lg shadow-sm focus:ring-pink-500 focus:border-pink-500"
        placeholder="e.g., 'severe cramps between periods', 'unusually heavy bleeding'"
      />
      <button
        onClick={handleSubmit}
        disabled={isLoading || !symptoms}
        className="w-full mt-3 bg-pink-600 text-white font-bold py-3 px-4 rounded-lg shadow hover:bg-pink-700 transition disabled:opacity-50 flex items-center justify-center"
      >
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Analyze Symptoms"}
      </button>

      {aiResponse && (
        <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <h4 className="font-semibold text-gray-800 mb-2">Health Insight:</h4>
          <p className="text-gray-700 whitespace-pre-wrap">{aiResponse}</p>
          <div className="mt-3 p-3 bg-red-100 border border-red-300 text-red-800 rounded-lg flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2 flex-shrink-0" />
            <p className="text-sm font-medium">
              <strong>Important:</strong> This is NOT a medical diagnosis. Please consult a doctor or healthcare professional for any health concerns.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}


// --- New Component: Nutrition Tips ---
function NutritionTips({ onBack }) {
  const tips = [
    { title: 'Folic Acid is Key', content: 'Take a prenatal vitamin with at least 400mcg of folic acid daily, especially in the first 12 weeks, to help prevent birth defects.' },
    { title: 'Eat Your Colors', content: 'Fill your plate with colorful fruits and vegetables. They provide essential vitamins and minerals for you and your baby.' },
    { title: 'Lean Protein', content: 'Include sources of lean protein like chicken, fish (low-mercury), beans, and lentils. Protein is crucial for your baby\'s growth.' },
    { title: 'Calcium for Bones', content: 'Get plenty of calcium from dairy, fortified non-dairy milk, or dark leafy greens to support your baby\'s bone development.' },
    { title: 'Hydrate, Hydrate!', content: 'Drink plenty of water (around 8-12 glasses a day). It helps form amniotic fluid and supports your increased blood volume.' },
    { title: 'Food Safety', content: 'Avoid raw or undercooked meat, unpasteurized dairy, and high-mercury fish to prevent infections that can harm your baby.' }
  ];

  return (
    <div className="p-4 pt-8 animate-slide-in">
      <header className="flex items-center mb-6">
        <button onClick={onBack} className="mr-3 p-2 rounded-full hover:bg-gray-100">
          <ArrowLeft className="w-6 h-6 text-gray-700" />
        </button>
        <h1 className="text-2xl font-bold text-purple-800">Nutrition Tips</h1>
      </header>
      <div className="space-y-4">
        {tips.map(tip => (
          <div key={tip.title} className="bg-purple-50 p-4 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-purple-900">{tip.title}</h3>
            <p className="text-purple-800 text-sm mt-1">{tip.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- New Component: Ask Pregnancy Query ---
function AskQuery({ onBack }) {
  const [query, setQuery] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    if (!query) return;
    setIsLoading(true);
    setAiResponse('');

    const systemPrompt = "You are a helpful assistant for a pregnant user in a health app. The user is asking a non-urgent, general question about pregnancy. Provide a supportive, informative, and clear answer. **CRITICAL:** Always end your response with a clear disclaimer that this is general information, not medical advice, and they must consult their doctor or midwife for any personal health concerns.";
    
    const userQuery = `My question is: "${query}".`;
    
    const response = await callGemini(systemPrompt, userQuery);
    setAiResponse(response);
    setIsLoading(false);
  };

  return (
    <div className="p-4 pt-8 animate-slide-in">
      <header className="flex items-center mb-6">
        <button onClick={onBack} className="mr-3 p-2 rounded-full hover:bg-gray-100">
          <ArrowLeft className="w-6 h-6 text-gray-700" />
        </button>
        <h1 className="text-2xl font-bold text-purple-800">Ask a Query</h1>
      </header>
      <div>
        <p className="text-sm text-gray-600 mb-3">
          Ask a general question about pregnancy. This tool provides information, not a medical diagnosis.
        </p>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full p-2 h-24 border border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500"
          placeholder="e.g., 'What are some common food cravings?', 'Tips for sleeping better...'"
        />
        <button
          onClick={handleSubmit}
          disabled={isLoading || !query}
          className="w-full mt-3 bg-purple-600 text-white font-bold py-3 px-4 rounded-lg shadow hover:bg-purple-700 transition disabled:opacity-50 flex items-center justify-center"
        >
          {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Get Answer"}
        </button>

        {aiResponse && (
          <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <h4 className="font-semibold text-gray-800 mb-2">Answer:</h4>
            <p className="text-gray-700 whitespace-pre-wrap">{aiResponse}</p>
            <div className="mt-3 p-3 bg-red-100 border border-red-300 text-red-800 rounded-lg flex items-center">
              <AlertTriangle className="w-5 h-5 mr-2 flex-shrink-0" />
              <p className="text-sm font-medium">
                <strong>Disclaimer:</strong> This is general information, not medical advice. Please consult your doctor for any personal health concerns.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// --- Pregnancy Mode Component ---
function PregnancyMode({ userData }) {
  const [view, setView] = useState('main'); // 'main', 'nutrition', 'query'
  const pregnancyInfo = useMemo(() => calculatePregnancyWeek(userData.pregnancyDueDate), [userData.pregnancyDueDate]);

  if (!pregnancyInfo) {
    return <ErrorScreen message="Could not calculate pregnancy data. Please check your due date." />;
  }
  
  const { week, days } = pregnancyInfo;

  // Mock data - a real app would fetch this
  const weeklyInsights = {
    8: { title: "Baby is the size of a raspberry!", content: "Your baby's fingers and toes are now forming. You might be feeling morning sickness. Try eating small, frequent meals." },
    12: { title: "Baby can make a fist!", content: "Your baby is fully formed! The risk of miscarriage drops. You might notice your clothes getting tighter." },
    20: { title: "Halfway there!", content: "You might feel your baby move (quickening)! The 20-week anatomy scan is usually around this time." },
    40: { title: "Full term!", content: "Baby is ready! Look for signs of labor, like regular contractions or your water breaking. Rest up!" }
  };
  
  // Find the closest insight
  const insight = weeklyInsights[week] || weeklyInsights[Object.keys(weeklyInsights).find(k => k > week)] || { title: "Growing every day!", content: "Remember to take your prenatal vitamins and stay hydrated." };


  if (view === 'nutrition') {
    return <NutritionTips onBack={() => setView('main')} />;
  }
  
  if (view === 'query') {
    return <AskQuery onBack={() => setView('main')} />;
  }

  return (
    <div className="p-4 pt-8 animate-slide-in relative">
      <button className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 text-gray-600" title="Change Language">
        <Languages className="w-6 h-6" />
      </button>
      <header className="text-center mb-6">
        <Baby className="w-16 h-16 text-purple-600 mx-auto" />
        <h1 className="text-4xl font-bold text-purple-800 mt-2">{week} Weeks{days > 0 && `, ${days} Days`}</h1>
        <p className="text-lg text-gray-600">of Pregnancy</p>
      </header>

      <div className="bg-purple-50 p-6 rounded-lg shadow-lg">
        <h2 className="text-xl font-semibold text-purple-900 mb-2">{insight.title}</h2>
        <p className="text-purple-800">{insight.content}</p>
      </div>

      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-3">Your Journey</h3>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="flex justify-between text-sm">
            <span>Start</span>
            <span>Due: {prettyFormatDate(userData.pregnancyDueDate)}</span>
          </p>
          <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
            <div 
              className="bg-purple-600 h-2.5 rounded-full" 
              style={{ width: `${(week / 40) * 100}%` }}
            ></div>
          </div>
          <p className="text-center text-sm font-medium text-purple-700 mt-2">{week} / 40 Weeks</p>
        </div>
      </div>
      
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-3">Quick Actions</h3>
        <div className="space-y-3">
          <button className="w-full p-4 bg-white rounded-lg shadow text-left text-gray-700 font-medium flex items-center">
            <User className="w-5 h-5 text-purple-600 mr-3" />
            Track Symptoms & Weight
          </button>
          <button 
            onClick={() => setView('nutrition')}
            className="w-full p-4 bg-white rounded-lg shadow text-left text-gray-700 font-medium flex items-center"
          >
            <BookOpen className="w-5 h-5 text-purple-600 mr-3" />
            Pregnancy Nutrition Tips
          </button>
          <button 
            onClick={() => setView('query')}
            className="w-full p-4 bg-white rounded-lg shadow text-left text-gray-700 font-medium flex items-center"
          >
            <HelpCircle className="w-5 h-5 text-purple-600 mr-3" />
            Ask a General Query
          </button>
        </div>
      </div>

      <div className="mt-6 p-4 bg-gray-100 rounded-lg text-center">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">Need Help?</h3>
        <p className="text-sm text-gray-600 mb-3">
          For urgent medical concerns, please contact your doctor or a healthcare professional.
        </p>
        <a 
          href="tel:102" 
          className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white font-bold rounded-lg shadow hover:bg-blue-700 transition"
        >
          <Phone className="w-4 h-4 mr-2" />
          Call Health Helpline (e.g., 102)
        </a>
        <p className="text-xs text-gray-500 mt-2">
          (This is a placeholder number for a national health service.)
        </p>
      </div>
    </div>
  );
}

// --- Share Modal (For Rural Health Workers) ---
function ShareModal({ userData, cycleData, onClose }) {
  const [copyStatus, setCopyStatus] = useState(''); // 'copied', 'failed', ''

  const summary = `
**Health Summary**
Age: ${userData.age}
Average Cycle: ${userData.cycleLength} days
Average Period: ${userData.periodLength} days

**Current Cycle**
Last Period Start: ${prettyFormatDate(userData.lastPeriodDate)}
Estimated Next Period: ${prettyFormatDate(cycleData.nextPeriodDate)}
Estimated Fertile Window: ${prettyFormatDate(cycleData.fertileStart)} - ${prettyFormatDate(cycleData.fertileEnd)}

**Recent Logs:**
${(userData.symptomsLog || []).slice(-3).map(log => `
- **${prettyFormatDate(log.date)}:**
  Mood: ${log.mood || 'N/A'}
  Symptoms: ${log.symptoms.join(', ') || 'N/A'}
  Cravings: ${log.cravings || 'N/A'}
`).join('') || 'No recent logs.'}
  `;

  const handleCopyToClipboard = () => {
    setCopyStatus(''); // Clear previous status
    
    // Use navigator.clipboard for modern browsers
    if (navigator.clipboard) {
      navigator.clipboard.writeText(summary.trim()).then(() => {
        setCopyStatus('copied');
        setTimeout(() => setCopyStatus(''), 2000);
      }).catch(err => {
        console.error('Failed to copy summary:', err);
        setCopyStatus('failed');
        setTimeout(() => setCopyStatus(''), 2000);
      });
    } else {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = summary.trim();
      textArea.style.position = 'fixed'; // Prevent scrolling
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopyStatus('copied');
        setTimeout(() => setCopyStatus(''), 2000); // Clear message after 2s
      } catch (err) {
        console.error('Failed to copy summary:', err);
        setCopyStatus('failed');
        setTimeout(() => setCopyStatus(''), 2000); // Clear message after 2s
      }
      document.body.removeChild(textArea);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[80vh] flex flex-col">
        <header className="flex justify-between items-center p-4 border-b">
          <h2 className="text-lg font-semibold">Share Summary</h2>
          <button onClick={onClose}><X className="w-6 h-6 text-gray-500" /></button>
        </header>
        <div className="p-4 overflow-y-auto">
          <p className="text-sm text-gray-600 mb-3">
            This is a simple summary of your cycle data. You can copy this text to share with a health worker or doctor.
          </p>
          <pre className="text-sm p-3 bg-gray-100 rounded-lg whitespace-pre-wrap overflow-x-auto">
            {summary.trim()}
          </pre>
        </div>
        <footer className="p-4 border-t bg-gray-50">
          <button
            onClick={handleCopyToClipboard}
            className="w-full bg-pink-600 text-white font-bold py-3 px-4 rounded-lg shadow hover:bg-pink-700 transition"
          >
            Copy Summary to Clipboard
          </button>
          {copyStatus === 'copied' && (
            <p className="text-center text-sm text-green-600 mt-2">Copied to clipboard!</p>
          )}
          {copyStatus === 'failed' && (
            <p className="text-center text-sm text-red-600 mt-2">Failed to copy. Please try manually.</p>
          )}
        </footer>
      </div>
    </div>
  );
}