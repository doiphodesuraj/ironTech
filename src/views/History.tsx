import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db, collection, query, orderBy, onSnapshot } from '../lib/firebase';
import { WorkoutSession } from '../types';
import { History as HistoryIcon, Calendar, TrendingUp } from 'lucide-react';

export default function History() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users', user.uid, 'sessions'), orderBy('startTime', 'desc'));
    return onSnapshot(q, (snap) => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkoutSession)));
      setLoading(false);
    });
  }, [user]);

  if (loading) return (
    <div className="flex items-center justify-center p-20">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-neon-blue"></div>
    </div>
  );

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom duration-700">
      <header>
        <h1 className="text-5xl font-black italic uppercase tracking-tighter flex items-center gap-4">
          <HistoryIcon size={48} className="text-neon-blue" />
          <span className="bg-gradient-to-r from-neon-blue to-neon-purple bg-clip-text text-transparent">Workout History</span>
        </h1>
      </header>

      <div className="space-y-8">
        {sessions.length === 0 ? (
          <div className="glass-card p-20 text-center italic font-medium text-gray-500">
             No chronometric data detected. Initialize cycle to record history.
          </div>
        ) : (
          sessions.map(session => (
            <div key={session.id} className="glass-card overflow-hidden group float-3d">
              <div className="p-6 bg-white/5 border-b border-white/5 flex justify-between items-center group-hover:bg-neon-blue/10 transition-colors">
                <div className="flex items-center gap-6">
                  <div className="p-3 bg-neon-blue/10 rounded-xl text-neon-blue">
                    <Calendar size={24} />
                  </div>
                  <span className="font-mono font-bold text-gray-300">
                    {session.startTime?.toDate().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 leading-none mb-1">Total Volume</p>
                  <p className="text-2xl font-black italic text-white tracking-tighter">
                    {(session.totalVolume || 0).toLocaleString()} <span className="text-xs text-neon-blue">KG</span>
                  </p>
                </div>
              </div>
              
              <div className="p-8">
                <h3 className="text-3xl font-black uppercase italic mb-8 tracking-tight">{session.name}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-6">
                  {session.exercises.map((ex, i) => (
                    <div key={i} className="flex justify-between items-center border-b border-white/5 pb-4">
                       <div className="flex items-center gap-4">
                          <span className="text-[10px] font-mono text-neon-blue opacity-30">{(i+1).toString().padStart(2, '0')}</span>
                          <span className="font-black uppercase italic text-sm text-gray-300">{ex.name}</span>
                       </div>
                       <div className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {ex.sets.map((s, si) => (
                              <span key={si} className="text-[10px] font-mono bg-white/5 px-2 py-1 rounded text-neon-blue border border-white/5">
                                {s.weight}×{s.reps}
                              </span>
                            ))}
                          </div>
                       </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
