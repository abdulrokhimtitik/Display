import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import {
    getFirestore,
    collection,
    doc,
    addDoc,
    setDoc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    orderBy,
    limit,
    deleteDoc,
    serverTimestamp,
    Timestamp,
    where
} from 'firebase/firestore';
import { PlusCircle, X, UploadCloud, Trash2, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';

// Konfigurasi Firebase (gantilah dengan konfigurasi Anda jika ada)
// __firebase_config akan disediakan oleh environment Canvas
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "YOUR_API_KEY", // Ganti jika tidak ada __firebase_config
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Inisialisasi Firebase
const app = initializeApp(firebaseConfig);
const dbGlobal = getFirestore(app);
const authGlobal = getAuth(app);

// Helper untuk format angka counter
const formatCounter = (num) => String(num).padStart(4, '0');

// Helper untuk format tanggal dan waktu
const formatDateAndTime = (date) => {
    const days = ["MINGGU", "SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU"];
    const dayName = days[date.getDay()];
    const time = `${String(date.getHours()).padStart(2, '0')}.${String(date.getMinutes()).padStart(2, '0')}`;
    const dateStr = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
    return { dayName, time, dateStr };
};

const App = () => {
    // State untuk Firebase
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    // State aplikasi
    const [currentDateTime, setCurrentDateTime] = useState(formatDateAndTime(new Date()));
    const [jobs, setJobs] = useState([]);
    const [selectedJobId, setSelectedJobId] = useState(null);
    const [history, setHistory] = useState([]);
    const [videoSrc, setVideoSrc] = useState(null); // Ganti dengan URL video default jika ada
    const videoInputRef = useRef(null);

    const [isJobModalOpen, setIsJobModalOpen] = useState(false);
    const [newJobName, setNewJobName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [performanceInsight, setPerformanceInsight] = useState(''); // State untuk insight Gemini
    const [isGeneratingInsight, setIsGeneratingInsight] = useState(false); // State untuk loading insight

    // Inisialisasi Firebase dan otentikasi
    useEffect(() => {
        setDb(dbGlobal);
        setAuth(authGlobal);

        const attemptSignIn = async (authInstance) => {
            try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(authInstance, __initial_auth_token);
                } else {
                    await signInAnonymously(authInstance);
                }
            } catch (err) {
                console.error("Error signing in:", err);
                setError("Gagal melakukan otentikasi.");
            }
        };
        
        const unsubscribe = onAuthStateChanged(authGlobal, async (user) => {
            if (user) {
                setUserId(user.uid);
                setIsAuthReady(true);
                console.log("User authenticated with UID:", user.uid);
            } else {
                // Jika tidak ada user, coba sign-in
                await attemptSignIn(authGlobal);
            }
        });
        
        // Jika tidak ada user setelah listener awal, coba sign-in (fallback)
        if (!authGlobal.currentUser) {
             attemptSignIn(authGlobal);
        }

        return () => unsubscribe();
    }, [appId]);

    // Update tanggal dan waktu setiap detik
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentDateTime(formatDateAndTime(new Date()));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Fetch jobs dari Firestore
    useEffect(() => {
        if (!isAuthReady || !db || !userId) return;

        const jobsCollectionPath = `artifacts/${appId}/users/${userId}/jobs`;
        const q = query(collection(db, jobsCollectionPath), orderBy("name"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const jobsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setJobs(jobsData);
            if (!selectedJobId && jobsData.length > 0) {
                // Otomatis pilih job pertama jika belum ada yang dipilih
                // dan reset counternya jika ini adalah pemilihan awal
                handleSelectJob(jobsData[0].id, true);
            } else if (selectedJobId && !jobsData.find(j => j.id === selectedJobId) && jobsData.length > 0) {
                // Jika job yang dipilih tidak ada lagi, pilih yang pertama
                 handleSelectJob(jobsData[0].id, true);
            } else if (jobsData.length === 0) {
                setSelectedJobId(null);
            }
        }, (err) => {
            console.error("Error fetching jobs:", err);
            setError("Gagal memuat data pekerjaan.");
        });
        return () => unsubscribe();
    }, [isAuthReady, db, userId, appId]);

    // Fetch history dari Firestore
    useEffect(() => {
        if (!isAuthReady || !db || !userId) return;

        const historyCollectionPath = `artifacts/${appId}/users/${userId}/history`;
        const q = query(collection(db, historyCollectionPath), orderBy("timestamp", "desc"), limit(5));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const historyData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setHistory(historyData);
        }, (err) => {
            console.error("Error fetching history:", err);
            setError("Gagal memuat riwayat pekerjaan.");
        });
        return () => unsubscribe();
    }, [isAuthReady, db, userId, appId]);

    // Fungsi untuk menambah job ke history dan membersihkan yang lama
    const addJobToHistory = useCallback(async (jobName, counterValue) => {
        if (!db || !userId || !isAuthReady) {
            setError("Database tidak siap.");
            return;
        }
        setIsLoading(true);
        try {
            const historyCollectionPath = `artifacts/${appId}/users/${userId}/history`;
            await addDoc(collection(db, historyCollectionPath), {
                jobName,
                counterValue,
                timestamp: serverTimestamp()
            });

            // Hapus entri history yang lebih dari 5
            const q = query(collection(db, historyCollectionPath), orderBy("timestamp", "desc"));
            const snapshot = await getDocs(q);
            if (snapshot.docs.length > 5) {
                for (let i = 5; i < snapshot.docs.length; i++) {
                    await deleteDoc(doc(db, historyCollectionPath, snapshot.docs[i].id));
                }
            }
        } catch (err) {
            console.error("Error adding to history:", err);
            setError("Gagal menyimpan riwayat.");
        } finally {
            setIsLoading(false);
        }
    }, [db, userId, isAuthReady, appId]);
    
    // Handler untuk memilih job
    const handleSelectJob = useCallback(async (jobId, isInitialSelection = false) => {
        if (!db || !userId || !isAuthReady) {
            setError("Database tidak siap.");
            return;
        }
        
        const previouslySelectedJobId = selectedJobId;
        setSelectedJobId(jobId);
        setIsJobModalOpen(false);
        setPerformanceInsight(''); // Clear previous insight when job changes

        // Reset currentCounter job yang baru dipilih jika bukan job yang sama atau ini bukan pemilihan awal
        // dan job yang dipilih berbeda dari sebelumnya
        if (jobId && (jobId !== previouslySelectedJobId || isInitialSelection)) {
            setIsLoading(true);
            try {
                const jobDocRef = doc(db, `artifacts/${appId}/users/${userId}/jobs`, jobId);
                await setDoc(jobDocRef, { currentCounter: 0 }, { merge: true });
            } catch (err) {
                console.error("Error resetting current counter on job select:", err);
                setError("Gagal mereset counter job.");
            } finally {
                setIsLoading(false);
            }
        }
    }, [db, userId, isAuthReady, appId, selectedJobId]);


    // Handler untuk menambah job baru
    const handleAddNewJob = async () => {
        if (!newJobName.trim() || !db || !userId || !isAuthReady) {
            setError(!newJobName.trim() ? "Nama job tidak boleh kosong." : "Database tidak siap.");
            return;
        }
        setIsLoading(true);
        try {
            const jobsCollectionPath = `artifacts/${appId}/users/${userId}/jobs`;
            // Cek apakah job dengan nama yang sama sudah ada
            const q = query(collection(db, jobsCollectionPath), where("name", "==", newJobName.trim()));
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                setError("Job dengan nama tersebut sudah ada.");
                setIsLoading(false);
                return;
            }

            const newJobRef = await addDoc(collection(db, jobsCollectionPath), {
                name: newJobName.trim(),
                currentCounter: 0, // Job baru mulai dengan counter 0
                totalCounter: 0,
                createdAt: serverTimestamp() // Opsional, untuk pengurutan jika diperlukan
            });
            setNewJobName('');
            setIsJobModalOpen(false); 
        } catch (err) {
            console.error("Error adding new job:", err);
            setError("Gagal menambah job baru.");
        } finally {
            setIsLoading(false);
        }
    };
    
    // Handler untuk mereset counter saat ini
    const handleResetCurrentCounter = async () => {
        if (!selectedJobId || !db || !userId || !isAuthReady) {
            setError(!selectedJobId ? "Pilih job terlebih dahulu." : "Database tidak siap.");
            return;
        }
        setIsLoading(true);
        const job = jobs.find(j => j.id === selectedJobId);
        if (job && job.currentCounter > 0) {
            await addJobToHistory(job.name, job.currentCounter);
        }
        try {
            const jobDocRef = doc(db, `artifacts/${appId}/users/${userId}/jobs`, selectedJobId);
            await setDoc(jobDocRef, { currentCounter: 0 }, { merge: true });
        } catch (err) {
            console.error("Error resetting current counter:", err);
            setError("Gagal mereset counter.");
        } finally {
            setIsLoading(false);
        }
    };

    // Handler untuk mereset total counter
    const handleResetTotalCounter = async () => {
        if (!selectedJobId || !db || !userId || !isAuthReady) {
            setError(!selectedJobId ? "Pilih job terlebih dahulu." : "Database tidak siap.");
            return;
        }
        setIsLoading(true);
        try {
            const jobDocRef = doc(db, `artifacts/${appId}/users/${userId}/jobs`, selectedJobId);
            await setDoc(jobDocRef, { totalCounter: 0 }, { merge: true });
        } catch (err) {
            console.error("Error resetting total counter:", err);
            setError("Gagal mereset total counter.");
        } finally {
            setIsLoading(false);
        }
    };

    // Handler untuk simulasi input ESP (increment counter)
    const handleIncrementCounter = async () => {
        if (!selectedJobId || !db || !userId || !isAuthReady) {
            setError(!selectedJobId ? "Pilih job terlebih dahulu." : "Database tidak siap.");
            return;
        }
        setIsLoading(true);
        const job = jobs.find(j => j.id === selectedJobId);
        if (job) {
            try {
                const jobDocRef = doc(db, `artifacts/${appId}/users/${userId}/jobs`, selectedJobId);
                await setDoc(jobDocRef, {
                    currentCounter: (job.currentCounter || 0) + 1,
                    totalCounter: (job.totalCounter || 0) + 1
                }, { merge: true });
            } catch (err) {
                console.error("Error incrementing counter:", err);
                setError("Gagal menambah counter.");
            } finally {
                setIsLoading(false);
            }
        }
    };
    
    // Handler untuk mengganti video
    const handleVideoChange = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setVideoSrc(e.target.result);
            };
            reader.readAsDataURL(file);
        }
    };

    // Fungsi untuk memanggil Gemini API untuk insight performa
    const getPerformanceInsight = async () => {
        if (!selectedJobData) {
            setError("Pilih job terlebih dahulu untuk mendapatkan insight.");
            return;
        }
        setIsGeneratingInsight(true);
        setPerformanceInsight('');
        setError('');

        const prompt = `Berikan insight singkat (maksimal 2 kalimat) tentang performa pekerjaan produksi ini.
                        Nama Pekerjaan: ${selectedJobData.name},
                        Counter Saat Ini: ${selectedJobData.currentCounter || 0},
                        Total Counter: ${selectedJobData.totalCounter || 0}.
                        Fokus pada status performa berdasarkan angka-angka ini.`;

        let chatHistory = [];
        chatHistory.push({ role: "user", parts: [{ text: prompt }] });
        const payload = { contents: chatHistory };
        const apiKey = ""; // Canvas akan menyediakan API key saat runtime
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            
            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                setPerformanceInsight(text);
            } else {
                setError("Gagal mendapatkan insight dari Gemini API. Struktur respons tidak terduga.");
                console.error("Unexpected Gemini API response structure:", result);
            }
        } catch (err) {
            console.error("Error calling Gemini API:", err);
            setError("Gagal terhubung ke Gemini API. Periksa koneksi atau konfigurasi.");
        } finally {
            setIsGeneratingInsight(false);
        }
    };


    const selectedJobData = jobs.find(job => job.id === selectedJobId);

    if (!isAuthReady) {
        return <div className="flex items-center justify-center min-h-screen bg-gray-100 text-gray-900"><div className="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-500"></div><p className="ml-4 text-xl">Menyiapkan Aplikasi...</p></div>;
    }

    return (
        // Container utama untuk mensimulasikan satu lembar PowerPoint dalam lanskap
        // min-h-screen dan p-4 untuk padding di TV
        <div className="bg-gray-100 text-gray-900 min-h-screen flex items-center justify-center p-4 font-sans">
            {/* Main "Slide" Container - Mempertahankan rasio aspek 16:9 */}
            {/* max-w-screen-2xl untuk layar TV yang lebih besar, p-6 untuk padding lebih besar */}
            <div className="w-full max-w-screen-2xl aspect-video bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                {/* p-5 untuk padding lebih besar, text-lg untuk ukuran font dasar lebih besar */}
                <header className="flex-shrink-0 p-5 bg-gray-200 border-b border-gray-300 flex justify-between items-start text-lg">
                    <div className="flex-shrink-0 text-left">
                        <h1 className="text-3xl font-bold text-blue-700">FUJI TECHNICA INDONESIA</h1>
                        <p className="text-base text-gray-700">member of ASTRA</p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                        <p className="text-xl font-semibold text-gray-900">JUMAT</p>
                        <p className="text-4xl font-bold text-gray-900">{currentDateTime.time}</p>
                        <p className="text-base text-gray-700">{currentDateTime.dateStr}</p>
                    </div>
                </header>

                {/* Main Content Area - Menggunakan flexbox untuk tata letak utama */}
                {/* p-6 untuk padding lebih besar */}
                <main className="flex-grow flex flex-col p-6 overflow-hidden">
                    {/* Job Display (Top Center) */}
                    {/* p-4 untuk padding lebih besar, text-3xl untuk nama job lebih besar */}
                    <div className="flex-shrink-0 bg-gray-400 p-4 rounded-lg shadow-md mb-6 text-center">
                        <div 
                            className="inline-flex items-center justify-center cursor-pointer hover:bg-gray-300 p-3 rounded transition-colors"
                            onClick={() => setIsJobModalOpen(true)}
                        >
                            <h2 className="text-3xl font-bold text-gray-900">
                                JOB: {selectedJobData ? selectedJobData.name : "Pilih Job"}
                            </h2>
                            {isJobModalOpen ? <ChevronUp size={32} className="ml-3" /> : <ChevronDown size={32} className="ml-3" />}
                        </div>
                    </div>

                    {/* Counters, History, and Video (Main Two Columns) */}
                    {/* gap-6 untuk jarak antar kolom lebih besar */}
                    <div className="flex-grow grid grid-cols-2 gap-6 overflow-hidden">
                        {/* Kolom Kiri: Counter & History */}
                        {/* space-y-4 untuk jarak antar elemen lebih besar. Hapus overflow-y-auto */}
                        <div className="flex flex-col space-y-4 pr-3">
                            {/* Counter */}
                            {/* p-4 untuk padding lebih besar */}
                            <div className="bg-gray-200 p-4 rounded-lg shadow-md">
                                <div className="flex justify-between items-center mb-2">
                                    <h2 className="text-xl font-semibold text-gray-700">Counter</h2>
                                    <button
                                        onClick={handleResetCurrentCounter}
                                        disabled={isLoading || !selectedJobId}
                                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md text-base transition-colors disabled:opacity-50 flex items-center"
                                    >
                                        <Trash2 size={16} className="mr-2" /> RESET
                                    </button>
                                </div>
                                <p className="text-7xl font-mono text-center py-2 bg-white rounded-md text-gray-900">
                                    {selectedJobData ? formatCounter(selectedJobData.currentCounter || 0) : "0000"}
                                </p>
                            </div>

                            {/* Total Counter */}
                            {/* p-4 untuk padding lebih besar */}
                            <div className="bg-gray-200 p-4 rounded-lg shadow-md">
                                <div className="flex justify-between items-center mb-2">
                                    <h2 className="text-xl font-semibold text-gray-700">Total Counter</h2>
                                    <button
                                        onClick={handleResetTotalCounter}
                                        disabled={isLoading || !selectedJobId}
                                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md text-base transition-colors disabled:opacity-50 flex items-center"
                                    >
                                        <Trash2 size={16} className="mr-2" /> RESET
                                    </button>
                                </div>
                                <p className="text-7xl font-mono text-center py-2 bg-white rounded-md text-gray-900">
                                    {selectedJobData ? formatCounter(selectedJobData.totalCounter || 0) : "0000"}
                                </p>
                            </div>

                            {/* History */}
                            {/* p-4 untuk padding lebih besar, text-base untuk ukuran font dasar.
                                 Tinggi history disesuaikan agar 5 item muat tanpa scroll.
                                 Menggunakan h-[calc(100%-XXXpx)] atau h-full jika flex-grow cukup.
                                 Karena ini flex-grow di dalam flex-col, dan total tinggi kolom terbatas,
                                 history akan mengisi sisa ruang tanpa scroll jika 5 item muat.
                                 Jika tidak muat, kita perlu lebih lanjut menyesuaikan ukuran font atau padding.
                                 Untuk memastikan tidak ada scrollbar, saya akan menghapus overflow-y-auto di sini.
                            */}
                            <div className="bg-gray-200 p-4 rounded-lg shadow-md flex-grow flex flex-col">
                                <h2 className="text-xl font-semibold text-gray-700 mb-3">History</h2>
                                <div className="space-y-2 pr-2 text-base"> {/* Menghapus overflow-y-auto */}
                                    {/* History Header */}
                                    <div className="flex justify-between items-center bg-blue-600 text-white p-3 rounded-md font-bold text-base">
                                        <span className="w-3/4">JOB</span>
                                        <span className="w-1/4 text-right">Counter</span>
                                    </div>
                                    {history.length === 0 && <p className="text-base text-gray-500 mt-3">Belum ada riwayat.</p>}
                                    {history.map(item => (
                                        <div key={item.id} className="flex justify-between items-center bg-white p-3 rounded-md text-lg">
                                            <span className="text-gray-900 truncate w-3/4" title={item.jobName}>{item.jobName}</span>
                                            <span className="font-semibold text-red-600 w-1/4 text-right">{formatCounter(item.counterValue)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {/* Tombol Simulasi ESP */}
                            {/* py-3 px-5 untuk padding lebih besar, text-lg untuk ukuran font */}
                            <button
                                onClick={handleIncrementCounter}
                                disabled={isLoading || !selectedJobId}
                                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-5 rounded-lg shadow-md transition-colors disabled:opacity-50 text-lg mt-4"
                            >
                                Simulasi Input ESP (+1)
                            </button>
                        </div>

                        {/* Kolom Kanan: Video Player & Gemini Insight */}
                        {/* space-y-4 untuk jarak antar elemen lebih besar */}
                        <div className="flex flex-col space-y-4 overflow-hidden">
                            {/* p-4 untuk padding lebih besar */}
                            <div className="bg-gray-200 p-4 rounded-lg shadow-md flex-grow aspect-video">
                                {videoSrc ? (
                                    <video
                                        src={videoSrc}
                                        controls
                                        loop
                                        autoPlay
                                        muted
                                        className="w-full h-full rounded-md cursor-pointer object-cover"
                                        onClick={() => videoInputRef.current && videoInputRef.current.click()}
                                    />
                                ) : (
                                    <div 
                                        className="w-full h-full flex flex-col items-center justify-center border-4 border-dashed border-gray-400 rounded-md cursor-pointer hover:bg-gray-300 transition-colors"
                                        onClick={() => videoInputRef.current && videoInputRef.current.click()}
                                    >
                                        <UploadCloud size={64} className="text-gray-500 mb-4" />
                                        <p className="text-xl text-gray-500">Klik untuk memilih video</p>
                                    </div>
                                )}
                                <input
                                    type="file"
                                    accept="video/*"
                                    ref={videoInputRef}
                                    onChange={handleVideoChange}
                                    className="hidden"
                                />
                            </div>

                            {/* Gemini Insight Feature */}
                            {/* p-4 untuk padding lebih besar */}
                            <div className="bg-gray-200 p-4 rounded-lg shadow-md">
                                <h2 className="text-xl font-semibold text-gray-700 mb-3">Insight Performa ✨</h2>
                                <button
                                    onClick={getPerformanceInsight}
                                    disabled={isGeneratingInsight || !selectedJobId}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-5 rounded-lg shadow-md transition-colors disabled:opacity-50 text-lg flex items-center justify-center"
                                >
                                    {isGeneratingInsight ? (
                                        <>
                                            <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-white mr-3"></div>
                                            Membuat Insight...
                                        </>
                                    ) : (
                                        <>
                                            <Lightbulb size={24} className="mr-3" /> Dapatkan Insight
                                        </>
                                    )}
                                </button>
                                {performanceInsight && (
                                    <p className="mt-4 text-lg text-gray-700 bg-gray-300 p-3 rounded-md">
                                        {performanceInsight}
                                    </p>
                                )}
                                {error && error.includes("Gemini API") && (
                                    <p className="mt-4 text-lg text-red-600 bg-red-200 p-3 rounded-md">
                                        {error}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </main>

                {/* Footer untuk User ID */}
                {/* p-3 untuk padding lebih besar, text-base untuk ukuran font */}
                <footer className="flex-shrink-0 p-3 text-center text-base text-gray-500 border-t border-gray-300">
                    User ID: {userId || "Belum terautentikasi"} | App ID: {appId}
                </footer>
            </div>

            {/* Job Selection Modal (Modal ini boleh scroll karena overlay) */}
            {isJobModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-8 z-50">
                    <div className="bg-gray-700 p-8 rounded-lg shadow-xl w-full max-w-lg">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-3xl font-semibold text-gray-100">Pilih atau Tambah Job</h3>
                            <button onClick={() => setIsJobModalOpen(false)} className="text-gray-400 hover:text-gray-200">
                                <X size={32} />
                            </button>
                        </div>
                        <div className="mb-6 max-h-80 overflow-y-auto"> {/* Modal ini tetap boleh scroll */}
                            {jobs.length === 0 && <p className="text-xl text-gray-400">Belum ada job. Tambahkan job baru.</p>}
                            {jobs.map(job => (
                                <div
                                    key={job.id}
                                    onClick={() => handleSelectJob(job.id)}
                                    className={`p-4 mb-3 rounded-md cursor-pointer transition-colors text-xl ${selectedJobId === job.id ? 'bg-blue-600 text-white' : 'bg-gray-600 hover:bg-gray-500 text-gray-200'}`}
                                >
                                    {job.name}
                                </div>
                            ))}
                        </div>
                        <div className="mt-6 pt-6 border-t border-gray-600">
                            <h4 className="text-2xl font-semibold mb-4 text-gray-100">Tambah Job Baru</h4>
                            <input
                                type="text"
                                value={newJobName}
                                onChange={(e) => setNewJobName(e.target.value)}
                                placeholder="Nama Job Baru"
                                className="w-full p-4 bg-gray-800 border border-gray-600 rounded-md mb-4 text-gray-100 text-xl focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <button
                                onClick={handleAddNewJob}
                                disabled={isLoading}
                                className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-4 px-6 rounded-md transition-colors disabled:opacity-50 text-xl flex items-center justify-center"
                            >
                                <PlusCircle size={28} className="mr-3" /> Tambah Job
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Loading Indicator (Global) */}
            {isLoading && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-500"></div>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="fixed bottom-8 right-8 bg-red-600 text-white p-6 rounded-lg shadow-xl max-w-md z-50">
                    <div className="flex justify-between items-center">
                        <p className="text-xl">{error}</p>
                        <button onClick={() => setError('')} className="ml-6 text-red-200 hover:text-white">
                            <X size={24} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
