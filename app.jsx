import React, { useState, useRef, useEffect } from 'react';

const CAMERA_INTERVAL_MS = 3000;
const QUESTION_TIMER_SECONDS = 30;

const defaultQuestion = (id) => ({ id, text: '', type: 'text', options: [''], correctAnswer: '', studentAnswer: '' });

export default function App() {
  const [phase, setPhase] = useState('setup');
  const [testType, setTestType] = useState('MCQ');
  const [numQuestions, setNumQuestions] = useState(3);
  const [questions, setQuestions] = useState([defaultQuestion(1), defaultQuestion(2), defaultQuestion(3)]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [questionTimer, setQuestionTimer] = useState(QUESTION_TIMER_SECONDS);
  const [totalScore, setTotalScore] = useState(0);
  const [cheatingScore, setCheatingScore] = useState(0);
  const [suspiciousLogs, setSuspiciousLogs] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [cameraError, setCameraError] = useState('');
  const [recording, setRecording] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const analysisTimerRef = useRef(null);
  const questionTimerRef = useRef(null);

  const appendLog = (message) => {
    setSuspiciousLogs((prev) => [...prev, `${new Date().toISOString()}: ${message}`]);
  };

  useEffect(() => {
    // question timer
    if (phase === 'test') {
      questionTimerRef.current = setInterval(() => {
        setQuestionTimer((prev) => {
          if (prev <= 1) {
            handleNextQuestion();
            return QUESTION_TIMER_SECONDS;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(questionTimerRef.current);
    }
    return () => clearInterval(questionTimerRef.current);
  }, [phase, currentQuestion]);

  useEffect(() => {
    return () => {
      clearInterval(analysisTimerRef.current);
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const validateSetup = () => {
    if (!testType) return false;
    if (!questions.length || questions.some((q) => !q.text.trim())) return false;
    if (testType === 'MCQ' && questions.some((q) => q.options.some((o) => !o.trim()) || !q.correctAnswer.trim())) return false;
    if ((testType === 'Theory' || testType === 'Viva') && questions.some((q) => !q.correctAnswer.trim())) return false;
    return true;
  };

  const resizeQuestionArray = (count) => {
    setQuestions((prev) => {
      const result = [...prev];
      while (result.length < count) {
        result.push(defaultQuestion(result.length + 1));
      }
      while (result.length > count) {
        result.pop();
      }
      return result;
    });
  };

  const changeQuestionField = (index, field, value) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const changeOption = (qIdx, optIdx, value) => {
    setQuestions((prev) => {
      const next = [...prev];
      const options = [...next[qIdx].options];
      options[optIdx] = value;
      next[qIdx] = { ...next[qIdx], options };
      return next;
    });
  };

  const addOption = (qIdx) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[qIdx] = { ...next[qIdx], options: [...next[qIdx].options, ''] };
      return next;
    });
  };

  const removeOption = (qIdx, optIdx) => {
    setQuestions((prev) => {
      const next = [...prev];
      const options = next[qIdx].options.filter((_, idx) => idx !== optIdx);
      next[qIdx] = { ...next[qIdx], options };
      return next;
    });
  };

  const handleStartTest = async () => {
    setCameraError('');

    if (!validateSetup()) {
      setCameraError('Setup invalid: fill all fields and answers first.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setPhase('test');
      setRecording(true);
      setCurrentQuestion(0);
      setQuestionTimer(QUESTION_TIMER_SECONDS);
      setCheatingScore(0);
      setSuspiciousLogs([]);
      setWarnings([]);

      analysisTimerRef.current = setInterval(async () => {
        try {
          const frameData = captureFrame();
          if (!frameData) return;

          const resp = await fetch('http://127.0.0.1:8000/analyze_frame', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ frame: frameData }),
          });

          if (!resp.ok) {
            setWarnings((prev) => [...prev, `API respond status = ${resp.status}`]);
            return;
          }
          const data = await resp.json();

          setCheatingScore((prev) => Math.min(100, prev + data.cheating_probability * 10));
          if (data.anomalies && data.anomalies.length) {
            data.anomalies.forEach((anom) => {
              appendLog(anom);
              setWarnings((prev) => [...prev, `Suspicious: ${anom}`]);
            });
          }
        } catch (err) {
          setWarnings((prev) => [...prev, 'Network/analysis error: ' + err.message]);
        }
      }, CAMERA_INTERVAL_MS);
    } catch (err) {
      setCameraError('Camera not accessible: ' + err.message);
      setPhase('setup');
    }
  };

  const captureFrame = () => {
    if (!canvasRef.current || !videoRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  };

  const handleNextQuestion = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion((prev) => prev + 1);
      setQuestionTimer(QUESTION_TIMER_SECONDS);
    } else {
      finishTest();
    }
  };

  const handlePrevQuestion = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion((prev) => prev - 1);
      setQuestionTimer(QUESTION_TIMER_SECONDS);
    }
  };

  const finishTest = () => {
    clearInterval(analysisTimerRef.current);
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    setRecording(false);

    const correctCount = questions.reduce((acc, q) => {
      if (!q.studentAnswer) return acc;
      const ans = q.studentAnswer.toString().trim().toLowerCase();
      const expected = q.correctAnswer.toString().trim().toLowerCase();
      return acc + (ans === expected ? 1 : 0);
    }, 0);

    setTotalScore(Math.round((correctCount / questions.length) * 100));
    setPhase('complete');
  };

  const renderSetup = () => (
    <section className="card section">
      <h2>1) Test Setup</h2>
      <label>
        Test Type:
        <select value={testType} onChange={(e) => setTestType(e.target.value)}>
          <option value="MCQ">MCQ</option>
          <option value="Theory">Theory</option>
          <option value="Viva">Viva</option>
        </select>
      </label>
      <label>
        Number of Questions:
        <input
          type="number"
          min={1}
          value={numQuestions}
          onChange={(e) => {
            const v = Math.max(1, Number(e.target.value));
            setNumQuestions(v);
            resizeQuestionArray(v);
          }}
        />
      </label>

      <div style={{ marginTop: 12 }}>
        <h3>Configure Questions</h3>
        {questions.map((q, idx) => (
          <div key={q.id} style={{ border: '1px solid #ccc', padding: 8, marginBottom: 8 }}>
            <label>
              Q{idx + 1} text:
              <input
                type="text"
                value={q.text}
                onChange={(e) => changeQuestionField(idx, 'text', e.target.value)}
                style={{ width: '100%' }}
              />
            </label>

            {testType === 'MCQ' && (
              <>
                <div style={{ marginTop: 8 }}>
                  Options:
                  {q.options.map((option, optIdx) => (
                    <div key={optIdx}>
                      <input
                        type="text"
                        value={option}
                        onChange={(e) => changeOption(idx, optIdx, e.target.value)}
                        style={{ width: '80%' }}
                      />
                      <button onClick={() => removeOption(idx, optIdx)} disabled={q.options.length <= 2}>-</button>
                    </div>
                  ))}
                </div>
                <button onClick={() => addOption(idx)}>Add option</button>
              </>
            )}

            <label style={{ display: 'block', marginTop: 8 }}>
              Correct Answer:
              <input
                type="text"
                value={q.correctAnswer}
                onChange={(e) => changeQuestionField(idx, 'correctAnswer', e.target.value)}
                style={{ width: '100%' }}
              />
            </label>
          </div>
        ))}
      </div>

      <button onClick={handleStartTest}>Start Test</button>
      {cameraError && <p className="alert-error">{cameraError}</p>}
    </section>
  );

  const renderTest = () => {
    const q = questions[currentQuestion];
    return (
      <section className="card section">
        <h2>2) Live Test (Type: {testType})</h2>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div>
              <strong>Question {currentQuestion + 1}/{questions.length}</strong>
              <p>{q.text}</p>
              {testType === 'MCQ' ? (
                q.options.map((o, idx) => (
                  <label key={idx} style={{ display: 'block' }}>
                    <input
                      type="radio"
                      name={`answer-${currentQuestion}`}
                      value={o}
                      checked={q.studentAnswer === o}
                      onChange={(e) => changeQuestionField(currentQuestion, 'studentAnswer', e.target.value)}
                    />
                    {o}
                  </label>
                ))
              ) : (
                <textarea
                  rows={4}
                  value={q.studentAnswer}
                  onChange={(e) => changeQuestionField(currentQuestion, 'studentAnswer', e.target.value)}
                  style={{ width: '100%' }}
                />
              )}
            </div>
            <div style={{ marginTop: 16 }}>
              <button onClick={handlePrevQuestion} disabled={currentQuestion === 0}>Previous</button>
              <button onClick={handleNextQuestion}>{currentQuestion === questions.length - 1 ? 'Finish' : 'Next'}</button>
            </div>
          </div>

          <div style={{ width: 320 }}>
            <div>
              <strong>Timer: {questionTimer}s</strong>
            </div>
            <div className="video-wrapper">
              <video ref={videoRef} autoPlay muted playsInline />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>
            <div>
              <p>Cheating score: {cheatingScore.toFixed(1)} / 100</p>
              {warnings.map((w, idx) => (
                <p key={idx} className="alert-warning"><small>{w}</small></p>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderComplete = () => (
    <section className="card section">
      <h2>3) Report</h2>
      <p>Total score: {totalScore}%</p>
      <p>Cheating score: {cheatingScore.toFixed(1)}</p>
      <h3>Suspicious logs</h3>
      <ul>
        {suspiciousLogs.length ? suspiciousLogs.map((log, idx) => <li key={idx}>{log}</li>) : <li>No anomalies recorded</li>}
      </ul>
      <button
        onClick={() => {
          setPhase('setup');
          setCheatingScore(0);
          setTotalScore(0);
          setWarnings([]);
          setSuspiciousLogs([]);
        }}
      >New Session</button>
    </section>
  );

  return (
    <div className="app-shell">
      <div className="app-content">
        <header className="app-header">
          <h1>AI-Based Cheating Detection Exam</h1>
          <p className="app-subtitle">Secure proctoring with live camera review and anomaly alerts.</p>
        </header>

        {phase === 'setup' && renderSetup()}
        {phase === 'test' && renderTest()}
        {phase === 'complete' && renderComplete()}

        {recording && <p className="status-success">Camera monitoring active</p>}
      </div>
    </div>
  );
}
