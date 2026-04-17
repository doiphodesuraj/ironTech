import React, { createContext, useContext, useState, useEffect } from 'react';
import { WorkoutSession, WorkoutStatus, ExerciseSession, SetLog } from '../types';
import { db, collection, addDoc, updateDoc, doc, serverTimestamp, OperationType, handleFirestoreError, setDoc, getDoc, Timestamp } from './firebase';
import { useAuth } from './AuthContext';

interface WorkoutContextType {
  activeSession: WorkoutSession | null;
  startSession: (name: string, templateId?: string, initialExercises?: any[]) => void;
  updateSession: (updated: Partial<WorkoutSession>) => void;
  finishSession: () => Promise<void>;
  discardSession: () => void;
  addExerciseToSession: (name: string, exerciseId: string) => void;
  addSetToExercise: (exerciseIndex: number) => void;
  updateSet: (exerciseIndex: number, setIndex: number, updatedSet: Partial<SetLog>) => void;
  removeSet: (exerciseIndex: number, setIndex: number) => void;
}

const WorkoutContext = createContext<WorkoutContextType | undefined>(undefined);

export function WorkoutProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [activeSession, setActiveSession] = useState<WorkoutSession | null>(null);

  // Persistence (optional but good for HMR-like feel or accidental refresh)
  useEffect(() => {
    const saved = localStorage.getItem('active_workout');
    if (saved && user) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.userId === user.uid) {
          setActiveSession(parsed);
        }
      } catch (e) {
        localStorage.removeItem('active_workout');
      }
    }
  }, [user]);

  useEffect(() => {
    if (activeSession) {
      localStorage.setItem('active_workout', JSON.stringify(activeSession));
    } else {
      localStorage.removeItem('active_workout');
    }
  }, [activeSession]);

  const startSession = (name: string, templateId?: string, initialExercises: any[] = []) => {
    if (!user) return;
    
    const exercises: ExerciseSession[] = initialExercises.map(ex => ({
      exerciseId: ex.exerciseId || Math.random().toString(36).substr(2, 9),
      name: ex.name,
      sets: ex.defaultSets ? Array(ex.defaultSets).fill({ reps: ex.defaultReps || 0, weight: ex.defaultWeight || 0 }) : [{ reps: 0, weight: 0 }]
    }));

    const session: WorkoutSession = {
      id: Math.random().toString(36).substr(2, 9),
      userId: user.uid,
      templateId,
      name,
      startTime: Date.now() as any, // Use local timestamp for tracking
      status: WorkoutStatus.ACTIVE,
      exercises
    };
    setActiveSession(session);
  };

  const updateSession = (updated: Partial<WorkoutSession>) => {
    setActiveSession(prev => prev ? { ...prev, ...updated } : null);
  };

  const addExerciseToSession = (name: string, exerciseId: string) => {
    setActiveSession(prev => {
      if (!prev) return null;
      return {
        ...prev,
        exercises: [...prev.exercises, { exerciseId, name, sets: [{ reps: 0, weight: 0 }] }]
      };
    });
  };

  const addSetToExercise = (exerciseIndex: number) => {
    setActiveSession(prev => {
      if (!prev) return null;
      const newExercises = [...prev.exercises];
      const ex = newExercises[exerciseIndex];
      const lastSet = ex.sets[ex.sets.length - 1];
      ex.sets = [...ex.sets, { ...lastSet }];
      return { ...prev, exercises: newExercises };
    });
  };

  const updateSet = (exerciseIndex: number, setIndex: number, updatedSet: Partial<SetLog>) => {
    setActiveSession(prev => {
      if (!prev) return null;
      const newExercises = [...prev.exercises];
      const ex = newExercises[exerciseIndex];
      const newSets = [...ex.sets];
      newSets[setIndex] = { ...newSets[setIndex], ...updatedSet };
      ex.sets = newSets;
      return { ...prev, exercises: newExercises };
    });
  };

  const removeSet = (exerciseIndex: number, setIndex: number) => {
    setActiveSession(prev => {
      if (!prev) return null;
      const newExercises = [...prev.exercises];
      const ex = newExercises[exerciseIndex];
      if (ex.sets.length <= 1) return prev;
      ex.sets = ex.sets.filter((_, i) => i !== setIndex);
      return { ...prev, exercises: newExercises };
    });
  };

  const finishSession = async () => {
    if (!user || !activeSession) return;
    
    // Calculate total volume
    let totalVolume = 0;
    activeSession.exercises.forEach(ex => {
      ex.sets.forEach(set => {
        totalVolume += (Number(set.reps || 0) * Number(set.weight || 0));
      });
    });

    try {
      // Ensure startTime is a valid Timestamp
      let firestoreStartTime: Timestamp;
      if (typeof activeSession.startTime === 'number') {
        firestoreStartTime = Timestamp.fromMillis(activeSession.startTime);
      } else if (activeSession.startTime && typeof (activeSession.startTime as any).toMillis === 'function') {
        // Already a timestamp (maybe from extreme edge case or future change)
        firestoreStartTime = activeSession.startTime;
      } else {
        // Fallback
        firestoreStartTime = Timestamp.now();
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, ...sessionDataToSave } = activeSession;
      
      const sessionData: any = {
        ...sessionDataToSave,
        status: WorkoutStatus.COMPLETED,
        endTime: serverTimestamp(),
        totalVolume,
        startTime: firestoreStartTime
      };

      // Remove undefined fields which Firestore doesn't support
      Object.keys(sessionData).forEach(key => {
        if (sessionData[key] === undefined) {
          delete sessionData[key];
        }
      });

      const sessionsRef = collection(db, 'users', user.uid, 'sessions');
      await addDoc(sessionsRef, sessionData);
      
      // Update user stats
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        const stats = userData?.stats || {};
        await updateDoc(userRef, {
          'stats.totalWorkouts': (stats.totalWorkouts || 0) + 1,
          'stats.lastWorkoutDate': serverTimestamp()
        });
      }

      // Check for PRs
      for (const ex of activeSession.exercises) {
        if (!ex.exerciseId) continue;
        
        let maxWeight = 0;
        ex.sets.forEach(s => {
          const w = Number(s.weight || 0);
          if (w > maxWeight) maxWeight = w;
        });

        if (maxWeight > 0) {
          const prRef = doc(db, 'users', user.uid, 'prs', ex.exerciseId);
          const prSnap = await getDoc(prRef);
          
          let isNewPR = false;
          if (!prSnap.exists()) {
            isNewPR = true;
          } else {
            const currentPrData = prSnap.data();
            if (currentPrData && maxWeight > (currentPrData.maxWeight || 0)) {
              isNewPR = true;
            }
          }

          if (isNewPR) {
            await setDoc(prRef, {
              userId: user.uid,
              exerciseId: ex.exerciseId,
              exerciseName: ex.name,
              maxWeight,
              date: serverTimestamp(),
              sessionId: activeSession.id
            });
          }
        }
      }

      setActiveSession(null);
      localStorage.removeItem('active_workout');
    } catch (error) {
      console.error("Finish session failure details:", error);
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/sessions`);
    }
  };

  const discardSession = () => {
    setActiveSession(null);
  };

  return (
    <WorkoutContext.Provider value={{ 
      activeSession, 
      startSession, 
      updateSession, 
      finishSession, 
      discardSession,
      addExerciseToSession,
      addSetToExercise,
      updateSet,
      removeSet
    }}>
      {children}
    </WorkoutContext.Provider>
  );
}

export const useWorkout = () => {
  const context = useContext(WorkoutContext);
  if (context === undefined) {
    throw new Error('useWorkout must be used within a WorkoutProvider');
  }
  return context;
}
