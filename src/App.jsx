import React, { useState, useEffect } from 'react';
import { Calendar, Users, Bell, LogOut, ChevronLeft, ChevronRight, Trash2, Edit3, CheckCircle, XCircle, UserPlus, Save, X, Building2, GitBranch, Briefcase, Clock, ClipboardList, RefreshCw } from 'lucide-react';
import { db, getMessagingInstance } from './firebase';
import { collection, doc, setDoc, getDocs, onSnapshot, deleteDoc, updateDoc, addDoc, query, orderBy } from 'firebase/firestore';
import { getToken, onMessage } from 'firebase/messaging';

const VAPID_KEY = 'BLTQzNLfMk1VJP8rUl7tnYmgvFP0s6Yv4LN6Ao9V7S6kaphS0aqE52O8Jdxt74UoPVV-x2hsFeJBzGyonAmWefI';
const LUNCH_START = '13:00';
const LUNCH_END = '14:00';

const INITIAL_USERS = [
  { id: '1', firstName: 'Mirco', lastName: 'Ronci', name: 'Mirco Ronci', username: 'mirco.ceo', password: '123', role: 'CEO' },
  { id: '2', firstName: 'Admin', lastName: 'User', name: 'Admin User', username: 'admin', password: '123', role: 'amministratore' },
  { id: '3', firstName: 'Silvia', lastName: 'Cori', name: 'Silvia Cori', username: 's.cori', password: '123', role: 'dipendente', resp1: '', resp2: '/' },
];

const POLIVALENZA_MSG = 'ATTENZIONE!!! DEI DIPENDENTI CON MANSIONI EQUIVALENTI STANNO CHIEDENDO LE FERIE NELLO STESSO PERIODO. VERIFICA PRIMA DI APPROVARE PER EVITARE DI LASCIARE SCOPERTA UNA O PIÙ FUNZIONI!';

// Calcola minuti escludendo pausa pranzo
const calcMinutesExcludingLunch = (fromStr, toStr) => {
  const toMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const from = toMins(fromStr);
  const to = toMins(toStr);
  const lunchS = toMins(LUNCH_START);
  const lunchE = toMins(LUNCH_END);
  if (to <= from) return 0;
  let total = to - from;
  const overlapStart = Math.max(from, lunchS);
  const overlapEnd = Math.min(to, lunchE);
  if (overlapEnd > overlapStart) total -= (overlapEnd - overlapStart);
  return Math.max(0, total);
};

const getISOWeek = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};

const formatMinutes = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m > 0 ? m + 'min' : ''}`.trim() : `${m}min`;
};

const formatDate = (isoStr) => {
  if (!isoStr) return '';
  const [y, m, d] = isoStr.split('-');
  return d + '/' + m + '/' + y;
};

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('calendar');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [users, setUsers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [closures, setClosures] = useState([]);
  const [polivalenze, setPolivalenze] = useState([]);
  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState([]);

  useEffect(() => {
    const initUsers = async () => {
      const snap = await getDocs(collection(db, 'users'));
      if (snap.empty) {
        for (const u of INITIAL_USERS) await setDoc(doc(db, 'users', u.id), u);
      }
      setLoading(false);
    };
    initUsers();
  }, []);

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'), snap => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubReqs = onSnapshot(query(collection(db, 'requests'), orderBy('createdAt', 'desc')), snap => setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubNotifs = onSnapshot(query(collection(db, 'notifications'), orderBy('createdAt', 'desc')), snap => setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubClosures = onSnapshot(collection(db, 'closures'), snap => setClosures(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubPoli = onSnapshot(collection(db, 'polivalenze'), snap => setPolivalenze(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubAudit = onSnapshot(query(collection(db, 'auditLog'), orderBy('createdAt', 'desc')), snap => setAuditLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { unsubUsers(); unsubReqs(); unsubNotifs(); unsubClosures(); unsubPoli(); unsubAudit(); };
  }, []);

  useEffect(() => {
    if (!user) return;
    let unsubscribe;
    const setupPush = async () => {
      try {
        const m = await getMessagingInstance();
        if (!m) return;
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          const token = await getToken(m, { vapidKey: VAPID_KEY });
          if (token) await updateDoc(doc(db, 'users', user.id), { fcmToken: token });
        }
        unsubscribe = onMessage(m, payload => alert('🔔 ' + payload.notification?.title + '\n' + payload.notification?.body));
      } catch (e) { console.log('Push non disponibile:', e); }
    };
    setupPush();
    return () => { if (unsubscribe) unsubscribe(); };
  }, [user]);

  const getClosureForDate = (dStr) => closures.find(c => dStr >= c.dal && dStr <= c.al) || null;

  const checkPolivalenza = async (submittedDates, submittingUser) => {
    const userGroups = polivalenze.filter(g => g.members && g.members.includes(submittingUser.name));
    for (const group of userGroups) {
      const otherMembers = (group.members || []).filter(m => m !== submittingUser.name);
      const overlapping = requests.filter(r =>
        otherMembers.includes(r.userName) &&
        (r.status === 'approvato' || r.status === 'pendente') &&
        r.dates && r.dates.some(d => submittedDates.includes(d))
      );
      if (overlapping.length > 0) {
        const responsibles = new Set();
        // Deduplicazione: un solo oggetto per nome dipendente
        const involvedMap = new Map();
        involvedMap.set(submittingUser.name, submittingUser);
        for (const r of overlapping) {
          const u = users.find(u => u.name === r.userName);
          if (u && !involvedMap.has(u.name)) involvedMap.set(u.name, u);
        }
        const allInvolved = [...involvedMap.values()];
        // Calcola le date di sovrapposizione effettiva
        const overlapDates = submittedDates.filter(d =>
          overlapping.some(r => r.dates && r.dates.includes(d))
        ).sort();
        const overlapDateStr = overlapDates.length === 1
          ? 'IL ' + formatDate(overlapDates[0])
          : 'DAL ' + formatDate(overlapDates[0]) + ' AL ' + formatDate(overlapDates[overlapDates.length - 1]);
        const involvedNames = allInvolved.map(u => u.name ? u.name.toUpperCase() : '').filter(Boolean);
        const namesStr = involvedNames.length > 1
          ? involvedNames.slice(0, -1).join(', ') + ' E ' + involvedNames[involvedNames.length - 1]
          : involvedNames[0] || '';
        const msg = `ATTENZIONE!!! DEI DIPENDENTI CON MANSIONI EQUIVALENTI STANNO CHIEDENDO LE FERIE NELLO STESSO PERIODO. VERIFICA PRIMA DI APPROVARE LE FERIE DI ${namesStr} (SOVRAPPOSIZIONE ${overlapDateStr}) PER EVITARE DI LASCIARE SCOPERTA UNA O PIÙ FUNZIONI!`;
        for (const u of allInvolved) {
          if (u && u.resp1 && u.resp1 !== '/') responsibles.add(u.resp1);
          if (u && u.resp2 === 'Mirco Ronci') responsibles.add('Mirco Ronci');
        }
        if (responsibles.size === 0) responsibles.add('Mirco Ronci');
        for (const resp of responsibles) {
          await addDoc(collection(db, 'notifications'), {
            to: resp, message: msg,
            date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false,
          });
        }
      }
    }
  };

  const writeAuditLog = async ({ action, fromUser, toUser, type, nota = '' }) => {
    try {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
      const code = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('.') + '.' + letter;
      const dateStr = pad(now.getDate()) + '/' + pad(now.getMonth()+1) + '/' + now.getFullYear();
      const timeStr = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
      await addDoc(collection(db, 'auditLog'), {
        code,
        username: fromUser?.username || fromUser?.name || '-',
        date: dateStr,
        time: timeStr,
        recipient: toUser || '-',
        type: type || '-',
        action: action || '-',
        nota: nota || '',
        createdAt: now.toISOString()
      });
    } catch(e) { console.log('Audit log error:', e); }
  };

  // BottomSheet component (shared)
  const BottomSheet = ({ children, onClose }) => (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-end justify-center z-50">
      <div className="bg-white p-6 rounded-t-[2.5rem] w-full max-w-lg shadow-2xl text-slate-800 pb-12 max-h-[85vh] overflow-y-auto">
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-6"></div>
        {children}
      </div>
    </div>
  );

  const AdminUsersView = () => {
    const emptyForm = { firstName: '', lastName: '', username: '', password: '', role: 'dipendente', resp1: '', resp2: '/' };
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState(emptyForm);
    const [poliForm, setPoliForm] = useState({ name: '', members: [] });
    const [poliEditId, setPoliEditId] = useState(null);

    const responsabili = users.filter(u => u.role === 'responsabile');
    const dipendenti = users.filter(u => u.role !== 'CEO');

    const handleNameChange = (field, value) => {
      const updated = { ...formData, [field]: value };
      if (field === 'firstName' || field === 'lastName') {
        const initial = updated.firstName ? updated.firstName.charAt(0).toLowerCase() : '';
        const surname = updated.lastName ? updated.lastName.toLowerCase().replace(/\s+/g, '') : '';
        updated.username = initial && surname ? initial + '.' + surname : initial || surname;
      }
      setFormData(updated);
    };

    const handleRoleChange = (role) => {
      if (role === 'responsabile') setFormData(f => ({ ...f, role, resp1: '/', resp2: 'Mirco Ronci' }));
      else setFormData(f => ({ ...f, role }));
    };

    const handleSave = async () => {
      if (!formData.firstName || !formData.lastName) return alert('Inserisci Nome e Cognome');
      const fullData = { ...formData, name: formData.firstName + ' ' + formData.lastName, id: editingId || Date.now().toString() };
      await setDoc(doc(db, 'users', fullData.id), fullData);
      setEditingId(null); setFormData(emptyForm);
    };

    const handleResetAll = async () => {
      if (!window.confirm('Sei sicuro di voler cancellare TUTTE le richieste e le notifiche?')) return;
      const [reqSnap, notifSnap] = await Promise.all([getDocs(collection(db, 'requests')), getDocs(collection(db, 'notifications'))]);
      await Promise.all([...reqSnap.docs.map(d => deleteDoc(doc(db, 'requests', d.id))), ...notifSnap.docs.map(d => deleteDoc(doc(db, 'notifications', d.id)))]);
    };

    const togglePoliMember = (name) => {
      setPoliForm(f => ({ ...f, members: f.members.includes(name) ? f.members.filter(m => m !== name) : [...f.members, name] }));
    };

    const handlePoliSave = async () => {
      if (!poliForm.name.trim()) return alert('Inserisci il nome del gruppo');
      if (poliForm.members.length < 2) return alert('Seleziona almeno 2 dipendenti');
      if (poliEditId) {
        await updateDoc(doc(db, 'polivalenze', poliEditId), { name: poliForm.name, members: poliForm.members });
      } else {
        await addDoc(collection(db, 'polivalenze'), { name: poliForm.name, members: poliForm.members, createdAt: new Date().toISOString() });
      }
      setPoliForm({ name: '', members: [] }); setPoliEditId(null);
    };

    const isResp = formData.role === 'responsabile';

    return (
      <div className="space-y-5 pb-6">
        <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200">
          <h3 className="text-base font-black uppercase italic mb-4 flex items-center gap-2 text-blue-600">
            {editingId ? <Edit3 size={18}/> : <UserPlus size={18}/>} {editingId ? 'Modifica' : 'Nuovo Collaboratore'}
          </h3>
          <div className="grid grid-cols-1 gap-3">
            <div className="grid grid-cols-2 gap-3">
              <input type="text" placeholder="Nome" className="p-4 bg-slate-50 border rounded-2xl font-bold outline-none text-sm" value={formData.firstName} onChange={e => handleNameChange('firstName', e.target.value)} />
              <input type="text" placeholder="Cognome" className="p-4 bg-slate-50 border rounded-2xl font-bold outline-none text-sm" value={formData.lastName} onChange={e => handleNameChange('lastName', e.target.value)} />
            </div>
            <input type="text" placeholder="Username" className="p-4 bg-white border-2 border-blue-100 rounded-2xl font-black text-blue-600 outline-none text-sm" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} />
            <input type="password" placeholder="Password" className="p-4 bg-slate-50 border rounded-2xl font-bold outline-none text-sm" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
            <select className="p-4 bg-slate-50 border rounded-2xl font-bold outline-none text-sm" value={formData.role} onChange={e => handleRoleChange(e.target.value)}>
              <option value="dipendente">Dipendente</option>
              <option value="responsabile">Responsabile</option>
              <option value="amministratore">Amministratore</option>
              <option value="CEO">CEO</option>
            </select>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase pl-1">Responsabile</label>
                <select className="mt-1 w-full p-4 bg-slate-50 border rounded-2xl font-bold outline-none text-sm disabled:opacity-50" value={formData.resp1 || ''} disabled={isResp} onChange={e => setFormData({...formData, resp1: e.target.value})}>
                  <option value="/">/</option>
                  {responsabili.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase pl-1">Anche a Mirco</label>
                <select className="mt-1 w-full p-4 bg-slate-50 border rounded-2xl font-bold outline-none text-sm disabled:opacity-50" value={formData.resp2 || '/'} disabled={isResp} onChange={e => setFormData({...formData, resp2: e.target.value})}>
                  <option value="/">/</option>
                  <option value="Mirco Ronci">Mirco Ronci</option>
                </select>
              </div>
            </div>
            <button onClick={handleSave} className="bg-blue-600 text-white rounded-2xl font-black uppercase flex items-center justify-center gap-2 hover:bg-blue-700 transition-all py-4">
              <Save size={18}/> {editingId ? 'Aggiorna' : 'Salva'}
            </button>
            {editingId && <button onClick={() => { setEditingId(null); setFormData(emptyForm); }} className="bg-slate-100 text-slate-400 rounded-2xl font-black uppercase py-3 text-sm">Annulla</button>}
          </div>
        </div>

        <div className="bg-white rounded-3xl border overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[560px]">
              <thead className="bg-slate-50 border-b">
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <th className="p-4">Collaboratore</th><th className="p-4">Ruolo</th><th className="p-4">Resp.</th><th className="p-4">Mirco</th><th className="p-4 text-right">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50/50">
                    <td className="p-4 font-black text-slate-800 uppercase text-sm">{u.firstName} {u.lastName}</td>
                    <td className="p-4"><span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-full text-[9px] font-black uppercase">{u.role}</span></td>
                    <td className="p-4 text-sm font-bold text-slate-600">{u.resp1 || '/'}</td>
                    <td className="p-4 text-sm font-bold text-slate-600">{u.resp2 || '/'}</td>
                    <td className="p-4 text-right space-x-1">
                      <button onClick={() => { setEditingId(u.id); setFormData({resp1: '', resp2: '/', ...u}); }} className="p-2 text-blue-400 hover:bg-blue-50 rounded-xl"><Edit3 size={16}/></button>
                      <button onClick={() => deleteDoc(doc(db, 'users', u.id))} className="p-2 text-red-300 hover:bg-red-50 rounded-xl"><Trash2 size={16}/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200">
          <h3 className="text-base font-black uppercase italic mb-4 flex items-center gap-2 text-purple-600">
            <GitBranch size={18}/> Matrice Polivalenze
          </h3>
          <div className="space-y-3">
            <input type="text" placeholder="Nome gruppo (es. Bolle di trasporto)" className="w-full p-4 bg-slate-50 border rounded-2xl font-bold outline-none text-sm" value={poliForm.name} onChange={e => setPoliForm({...poliForm, name: e.target.value})} />
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase pl-1 mb-2 block">Dipendenti del gruppo</label>
              <div className="grid grid-cols-2 gap-2">
                {dipendenti.map(u => (
                  <label key={u.id} className={'flex items-center gap-3 p-3 rounded-2xl border cursor-pointer transition-all ' + (poliForm.members.includes(u.name) ? 'bg-purple-50 border-purple-200' : 'bg-slate-50 border-slate-200')}>
                    <input type="checkbox" checked={poliForm.members.includes(u.name)} onChange={() => togglePoliMember(u.name)} className="w-5 h-5 accent-purple-600" />
                    <span className="text-sm font-bold text-slate-700 truncate">{u.firstName} {u.lastName}</span>
                  </label>
                ))}
              </div>
            </div>
            <button onClick={handlePoliSave} className="w-full bg-purple-600 text-white rounded-2xl font-black uppercase flex items-center justify-center gap-2 py-4">
              <Save size={18}/> {poliEditId ? 'Aggiorna Gruppo' : 'Salva Gruppo'}
            </button>
            {poliEditId && <button onClick={() => { setPoliForm({ name: '', members: [] }); setPoliEditId(null); }} className="w-full bg-slate-100 text-slate-400 rounded-2xl font-black uppercase py-3 text-sm">Annulla</button>}
          </div>
          {polivalenze.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-t pt-4">Gruppi esistenti</p>
              {polivalenze.map(g => (
                <div key={g.id} className="bg-slate-50 rounded-2xl p-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-800 text-sm uppercase">{g.name}</p>
                    <p className="text-xs text-slate-400 font-bold mt-0.5">{(g.members || []).join(', ')}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => { setPoliEditId(g.id); setPoliForm({ name: g.name, members: g.members || [] }); }} className="p-2 text-purple-400 hover:bg-purple-50 rounded-xl"><Edit3 size={16}/></button>
                    <button onClick={() => deleteDoc(doc(db, 'polivalenze', g.id))} className="p-2 text-red-300 hover:bg-red-50 rounded-xl"><Trash2 size={16}/></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {user.role === 'amministratore' && (
          <div className="bg-white p-5 rounded-3xl shadow-sm border border-red-100">
            <p className="font-black text-red-600 uppercase text-sm mb-1">Zona Pericolosa</p>
            <p className="text-xs text-slate-400 font-bold mb-3">Cancella tutte le richieste e le notifiche dal sistema</p>
            <button onClick={handleResetAll} className="w-full flex items-center justify-center gap-2 bg-red-500 text-white px-6 py-4 rounded-2xl font-black uppercase text-sm">
              <Trash2 size={16}/> Cancella tutte le richieste
            </button>
          </div>
        )}
      </div>
    );
  };

  const ClosuresView = () => {
    const emptyForm = { dal: '', al: '', descrizione: '', contaComeFerie: false };
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);

    const handleSave = async () => {
      if (!form.dal || !form.al) return alert('Inserisci le date Dal e Al');
      if (form.al < form.dal) return alert('La data Al deve essere dopo la data Dal');
      if (editingId) {
        await updateDoc(doc(db, 'closures', editingId), form);
      } else {
        await addDoc(collection(db, 'closures'), { ...form, createdAt: new Date().toISOString() });
      }
      setForm(emptyForm); setEditingId(null);
    };

    return (
      <div className="space-y-5 pb-6">
        <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200">
          <h3 className="text-base font-black uppercase italic mb-4 flex items-center gap-2 text-slate-700">
            <Building2 size={18}/> {editingId ? 'Modifica Chiusura' : 'Nuova Chiusura Aziendale'}
          </h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase pl-1">Dal</label>
                <input type="date" value={form.dal} onChange={e => setForm({...form, dal: e.target.value})} className="mt-1 w-full p-4 bg-slate-50 border rounded-2xl font-bold outline-none text-base" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase pl-1">Al</label>
                <input type="date" value={form.al} onChange={e => setForm({...form, al: e.target.value})} className="mt-1 w-full p-4 bg-slate-50 border rounded-2xl font-bold outline-none text-base" />
              </div>
            </div>
            <input type="text" placeholder="Descrizione (es. Ferragosto)" className="w-full p-4 bg-slate-50 border rounded-2xl font-bold outline-none text-sm" value={form.descrizione} onChange={e => setForm({...form, descrizione: e.target.value})} />
            <label className="flex items-center gap-4 p-4 bg-slate-50 border rounded-2xl cursor-pointer">
              <input type="checkbox" checked={form.contaComeFerie} onChange={e => setForm({...form, contaComeFerie: e.target.checked})} className="w-6 h-6 accent-purple-600" />
              <div>
                <p className="font-black text-slate-800 text-sm">Conta come ferie</p>
                <p className="text-[11px] text-slate-400 font-bold">Se attivo, scala dai giorni ferie dei dipendenti</p>
              </div>
            </label>
            <button onClick={handleSave} className="w-full bg-slate-800 text-white rounded-2xl font-black uppercase flex items-center justify-center gap-2 py-4">
              <Save size={18}/> {editingId ? 'Aggiorna' : 'Aggiungi Chiusura'}
            </button>
            {editingId && <button onClick={() => { setForm(emptyForm); setEditingId(null); }} className="w-full bg-slate-100 text-slate-400 rounded-2xl font-black uppercase py-3 text-sm">Annulla</button>}
          </div>
        </div>
        {closures.length === 0 && <p className="text-slate-400 text-sm font-bold text-center py-4">Nessuna chiusura aziendale configurata.</p>}
        {closures.map(c => (
          <div key={c.id} className={'bg-white p-5 rounded-3xl border shadow-sm ' + (c.contaComeFerie ? 'border-purple-200' : 'border-slate-200')}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={'px-2 py-0.5 rounded-full text-[10px] font-black uppercase text-white ' + (c.contaComeFerie ? 'bg-purple-500' : 'bg-slate-400')}>
                    {c.contaComeFerie ? 'Conta come ferie' : 'Festività'}
                  </span>
                </div>
                <p className="font-black text-slate-800 text-sm uppercase">{c.descrizione || '—'}</p>
                <p className="text-xs text-slate-400 font-bold mt-0.5">{c.dal} → {c.al}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => { setEditingId(c.id); setForm({ dal: c.dal, al: c.al, descrizione: c.descrizione || '', contaComeFerie: c.contaComeFerie || false }); }} className="p-2 text-blue-400 hover:bg-blue-50 rounded-xl"><Edit3 size={16}/></button>
                <button onClick={() => deleteDoc(doc(db, 'closures', c.id))} className="p-2 text-red-300 hover:bg-red-50 rounded-xl"><Trash2 size={16}/></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const CalendarView = () => {
    const initialFilter = () => {
      if (user.role === 'CEO' || user.role === 'amministratore') return 'all';
      if (user.role === 'responsabile') return 'all_mine';
      return 'mine';
    };
    const [calFilter, setCalFilter] = useState(initialFilter());
    const [selection, setSelection] = useState(null);
    const [requestType, setRequestType] = useState('ferie');
    const [form, setForm] = useState({ end: '', type: 'ferie', timeFrom: '09:00', timeTo: '10:00', mancataTimbratura: false, nota: '' });
    const [reqModal, setReqModal] = useState(null);
    const [modifyMode, setModifyMode] = useState(false);
    const [modifyForm, setModifyForm] = useState({ start: '', end: '', type: 'ferie', timeFrom: '09:00', timeTo: '10:00' });
    const [recipientModal, setRecipientModal] = useState(null);
    const [trasfertaStep, setTrasfertaStep] = useState(null);
    const [dayDetailModal, setDayDetailModal] = useState(null);
    const [dayActionReq, setDayActionReq] = useState(null);
    const [dayActionNote, setDayActionNote] = useState('');

    const month = currentDate.getMonth();
    const year = currentDate.getFullYear();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const subordinates = user ? users.filter(u => u.resp1 === user.name) : [];

    const visibleRequests = requests.filter(r => {
      if (user.role === 'dipendente') return r.userId === user.id;
      if (user.role === 'responsabile') {
        if (calFilter === 'mine') return r.userId === user.id;
        if (calFilter === 'all_mine') return r.userId === user.id || subordinates.some(s => s.id === r.userId);
        return r.userName === calFilter;
      }
      if (calFilter === 'all') return true;
      return r.userName === calFilter;
    });

    const buildDates = (start, end) => {
      const dates = [];
      let curr = new Date(start);
      const stop = new Date(end || start);
      while (curr <= stop) {
        if (curr.getDay() !== 0 && curr.getDay() !== 6) dates.push(curr.toISOString().split('T')[0]);
        curr.setDate(curr.getDate() + 1);
      }
      return dates;
    };

    const getTypeLabel = (type) => {
      const map = { ferie: 'Ferie', permesso: 'Permesso', malattia: 'Malattia', fuorisede: 'Fuori sede', trasferta: 'Trasferta' };
      return map[type] || type;
    };

    const getTypeBadgeColor = (type, status) => {
      if (status === 'rifiutato') return 'bg-red-500';
      if (status === 'approvato' || status === 'comunicato' || type === 'malattia') return 'bg-green-500';
      return 'bg-orange-500';
    };

    const getSigla = (r) => {
      if (r.type === 'ferie') return 'F';
      if (r.type === 'permesso') return 'P';
      if (r.type === 'malattia') return 'M';
      if (r.type === 'trasferta') return 'T';
      if (r.type === 'fuorisede') return r.mancataTimbratura ? 'MM' : 'FS';
      return '';
    };

    const isPersonalView = user.role === 'dipendente' || calFilter === 'mine';

    const doSendFerie = async (assignedTo) => {
      const dates = buildDates(selection, form.end);
      if (dates.length === 0) return alert('Seleziona giorni lavorativi');
      const newReq = {
        userId: user.id, userName: user.name, type: requestType, dates,
        status: requestType === 'malattia' ? 'approvato' : 'pendente',
        assignedTo, createdAt: new Date().toISOString(),
        ...(form.nota ? { nota: form.nota } : {})
      };
      const reqRef = await addDoc(collection(db, 'requests'), newReq);
      if (newReq.status === 'pendente') {
        const dateRange = dates.length === 1
          ? 'il ' + formatDate(dates[0])
          : 'dal ' + formatDate(dates[0]) + ' al ' + formatDate(dates[dates.length - 1]) + ' (' + dates.length + ' giorni)';
        await addDoc(collection(db, 'notifications'), {
          to: assignedTo,
          message: 'Richiesta di ' + requestType + ' di ' + user.name + ' ' + dateRange + (form.nota ? ' — Nota: ' + form.nota : ''),
          date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), requestId: reqRef.id, read: false
        });
      }
      await checkPolivalenza(dates, user);
      await writeAuditLog({ action: 'inviata', fromUser: user, toUser: assignedTo, type: requestType, nota: form.nota || '' });
      setSelection(null); setRecipientModal(null);
    };

    const handleSendPermesso = async () => {
      const mins = calcMinutesExcludingLunch(form.timeFrom, form.timeTo);
      if (mins <= 0) return alert('Orario non valido');
      const assignedTo = user && user.resp1 && user.resp1 !== '/' ? user.resp1 : 'Mirco Ronci';
      const newReq = {
        userId: user.id, userName: user.name, type: 'permesso',
        dates: [selection], timeFrom: form.timeFrom, timeTo: form.timeTo,
        durationMinutes: mins, status: 'pendente', assignedTo,
        createdAt: new Date().toISOString(),
        ...(form.nota ? { nota: form.nota } : {})
      };
      const reqRef = await addDoc(collection(db, 'requests'), newReq);
      await addDoc(collection(db, 'notifications'), {
        to: assignedTo,
        message: 'Richiesta di permesso di ' + user.name + ' il ' + formatDate(selection) + ' dalle ' + form.timeFrom + ' alle ' + form.timeTo + ' (' + formatMinutes(mins) + ')' + (form.nota ? ' — Nota: ' + form.nota : ''),
        date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), requestId: reqRef.id, read: false
      });
      await writeAuditLog({ action: 'inviata', fromUser: user, toUser: assignedTo, type: 'permesso', nota: form.nota || '' });
      setSelection(null);
    };

    const handleSendFuoriSede = async () => {
      const mins = calcMinutesExcludingLunch(form.timeFrom, form.timeTo);
      if (mins <= 0) return alert('Orario non valido');
      const assignedTo = user && user.resp1 && user.resp1 !== '/' ? user.resp1 : 'Mirco Ronci';
      const status = form.mancataTimbratura ? 'pendente' : 'comunicato';
      const newReq = {
        userId: user.id, userName: user.name, type: 'fuorisede',
        dates: [selection], timeFrom: form.timeFrom, timeTo: form.timeTo,
        durationMinutes: mins, mancataTimbratura: form.mancataTimbratura,
        status, assignedTo, createdAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'requests'), newReq);
      const msg = form.mancataTimbratura
        ? 'ATTENZIONE! ' + user.name + ' ha una mancata timbratura il ' + formatDate(selection) + ' dalle ' + form.timeFrom + ' alle ' + form.timeTo + '. Approva per giustificarla.'
        : 'Fuori sede di ' + user.name + ' il ' + formatDate(selection) + ' dalle ' + form.timeFrom + ' alle ' + form.timeTo + ' (' + formatMinutes(calcMinutesExcludingLunch(form.timeFrom, form.timeTo)) + ')';
      await addDoc(collection(db, 'notifications'), {
        to: assignedTo, message: msg,
        date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false
      });
      await writeAuditLog({ action: 'inviata', fromUser: user, toUser: assignedTo, type: 'fuorisede', nota: form.nota || '' });
      setSelection(null);
    };

    const handleSendTrasferta = async () => {
      const dates = buildDates(selection, form.end);
      if (dates.length === 0) return alert('Seleziona giorni lavorativi');
      const resp1 = user && user.resp1 && user.resp1 !== '/' ? user.resp1 : null;
      const firstRecipient = resp1 || 'Mirco Ronci';
      const initialStatus = resp1 ? 'pendente_responsabile' : 'pendente_mirco';
      const newReq = {
        userId: user.id, userName: user.name, type: 'trasferta',
        dates, status: initialStatus, assignedTo: firstRecipient,
        createdAt: new Date().toISOString()
      };
      const reqRef = await addDoc(collection(db, 'requests'), newReq);
      await addDoc(collection(db, 'notifications'), {
        to: firstRecipient,
        message: 'Richiesta di trasferta di ' + user.name + ' dal ' + formatDate(dates[0]) + ' al ' + formatDate(dates[dates.length - 1]) + ' (' + dates.length + ' giorni)',
        date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), requestId: reqRef.id, read: false
      });
      await checkPolivalenza(dates, user);
      await writeAuditLog({ action: 'inviata', fromUser: user, toUser: firstRecipient, type: 'trasferta', nota: form.nota || '' });
      setSelection(null);
    };

    const handleSend = async () => {
      if (requestType === 'permesso') return handleSendPermesso();
      if (requestType === 'fuorisede') return handleSendFuoriSede();
      if (requestType === 'trasferta') return handleSendTrasferta();
      // ferie e malattia
      const dates = buildDates(selection, form.end);
      if (dates.length === 0) return alert('Seleziona giorni lavorativi');
      const resp1 = user && user.resp1 && user.resp1 !== '/' ? user.resp1 : null;
      const resp2 = user && user.resp2 === 'Mirco Ronci' ? 'Mirco Ronci' : null;
      if (resp1 && resp2 && requestType !== 'malattia') { setRecipientModal({ resp1, resp2 }); return; }
      await doSendFerie(resp1 || resp2 || 'Mirco Ronci');
    };

    const handleCancel = async (req) => {
      if (!window.confirm('Vuoi davvero cancellare questa richiesta?')) return;
      await deleteDoc(doc(db, 'requests', req.id));
      await addDoc(collection(db, 'notifications'), {
        to: req.assignedTo,
        message: (() => {
          const typeLabel = req.type === 'trasferta' ? 'trasferta' : req.type === 'permesso' ? 'permesso' : req.type === 'fuorisede' ? 'fuori sede' : 'ferie';
          const dateInfo = req.dates && req.dates.length > 0
            ? (req.dates.length === 1 ? ' del ' + formatDate(req.dates[0]) : ' dal ' + formatDate(req.dates[0]) + ' al ' + formatDate(req.dates[req.dates.length - 1]))
            : '';
          return 'ATTENZIONE! ' + user.name + ' ha cancellato la richiesta di ' + typeLabel + dateInfo;
        })(),
        date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false
      });
      await writeAuditLog({ action: 'cancellata', fromUser: user, toUser: req.assignedTo, type: req.type });
      setReqModal(null);
    };

    const handleModify = async (req) => {
      const dates = buildDates(modifyForm.start || req.dates[0], modifyForm.end || req.dates[req.dates.length - 1]);
      if (dates.length === 0) return alert('Seleziona giorni lavorativi');
      await updateDoc(doc(db, 'requests', req.id), { dates, type: modifyForm.type, updatedAt: new Date().toISOString() });
      await addDoc(collection(db, 'notifications'), {
        to: req.assignedTo,
        message: (() => {
          const dates2 = buildDates(modifyForm.start || req.dates[0], modifyForm.end || req.dates[req.dates.length - 1]);
          const dateInfo = dates2.length > 0
            ? ' dal ' + formatDate(dates2[0]) + ' al ' + formatDate(dates2[dates2.length - 1]) + ' (' + dates2.length + ' giorni)'
            : '';
          return 'ATTENZIONE! ' + user.name + ' ha modificato la richiesta di ' + req.type + dateInfo;
        })(),
        date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false
      });
      await writeAuditLog({ action: 'modificata', fromUser: user, toUser: req.assignedTo, type: req.type });
      setReqModal(null); setModifyMode(false);
    };

    const handleCellClick = (dStr, isWeekend, closure, dayReqs) => {
      if (isWeekend || closure) return;

      const isViewingOthers = user.role === 'CEO' ||
        (user.role === 'amministratore') ||
        (user.role === 'responsabile' && calFilter !== 'mine');

      if (isViewingOthers && dayReqs.length > 0) {
        setDayDetailModal({ date: dStr, reqs: dayReqs });
        return;
      }

      if (user.role === 'CEO') return;

      const myReq = dayReqs.find(r => r.userId === user.id);
      if (myReq) {
        setReqModal(myReq); setModifyMode(false);
        setModifyForm({ start: myReq.dates[0], end: myReq.dates[myReq.dates.length - 1], type: myReq.type, timeFrom: myReq.timeFrom || '09:00', timeTo: myReq.timeTo || '10:00' });
      } else {
        setForm({ end: '', type: requestType, timeFrom: '09:00', timeTo: '10:00', mancataTimbratura: false, nota: '' });
        setSelection(dStr);
      }
    };

    const filterOptions = () => {
      if (user.role === 'responsabile') return [
        { value: 'mine', label: 'Le mie ferie' },
        ...subordinates.map(s => ({ value: s.name, label: s.name })),
        ...(subordinates.length > 1 ? [{ value: 'all_mine', label: 'Tutti i miei dipendenti' }] : []),
      ];
      if (user.role === 'amministratore' || user.role === 'CEO') return [
        { value: 'all', label: 'Tutti' },
        ...users.filter(u => u.role !== 'CEO').map(u => ({ value: u.name, label: u.name })),
      ];
      return [];
    };

    const opts = filterOptions();

    const renderRequestForm = () => {
      const isPermesso = requestType === 'permesso';
      const isFuoriSede = requestType === 'fuorisede';
      const isTrasferta = requestType === 'trasferta';
      const isFerie = requestType === 'ferie' || requestType === 'malattia';

      return (
        <BottomSheet>
          <h3 className="text-xl font-black uppercase italic mb-4">{getTypeLabel(requestType)}</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 mb-2">
              {['ferie', 'malattia', 'permesso'].map(t => (
                <button key={t} onClick={() => setRequestType(t)} className={'py-3 rounded-2xl font-black text-xs uppercase transition-all ' + (requestType === t ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500')}>{getTypeLabel(t)}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {['fuorisede', 'trasferta'].map(t => (
                <button key={t} onClick={() => setRequestType(t)} className={'py-3 rounded-2xl font-black text-xs uppercase transition-all flex items-center justify-center gap-1 ' + (requestType === t ? (t === 'trasferta' ? 'bg-blue-800 text-white' : 'bg-teal-600 text-white') : 'bg-slate-100 text-slate-500')}>
                  {t === 'trasferta' ? <Briefcase size={14}/> : <Clock size={14}/>} {getTypeLabel(t)}
                </button>
              ))}
            </div>

            <div className="border-t pt-3">
              <div><label className="text-[10px] font-black text-slate-400 uppercase">Data</label><input type="date" value={selection} readOnly className="w-full p-4 bg-slate-50 border rounded-2xl font-bold mt-1 text-base" /></div>

              {(isFerie || isTrasferta) && (
                <div className="mt-3"><label className="text-[10px] font-black text-slate-400 uppercase">Data fine {isTrasferta ? '' : '(opzionale)'}</label><input type="date" min={selection} defaultValue={selection} onChange={e => setForm({...form, end: e.target.value})} className="w-full p-4 bg-slate-50 border rounded-2xl font-bold mt-1 text-base" /></div>
              )}

              {(isPermesso || isFuoriSede) && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div><label className="text-[10px] font-black text-slate-400 uppercase">Dalle</label><input type="time" value={form.timeFrom} onChange={e => setForm({...form, timeFrom: e.target.value})} className="w-full p-4 bg-slate-50 border rounded-2xl font-bold mt-1 text-base" /></div>
                  <div><label className="text-[10px] font-black text-slate-400 uppercase">Alle</label><input type="time" value={form.timeTo} onChange={e => setForm({...form, timeTo: e.target.value})} className="w-full p-4 bg-slate-50 border rounded-2xl font-bold mt-1 text-base" /></div>
                </div>
              )}

              {(isPermesso || isFuoriSede) && form.timeFrom && form.timeTo && (
                <p className="text-xs text-blue-600 font-black mt-2 pl-1">
                  Durata: {formatMinutes(calcMinutesExcludingLunch(form.timeFrom, form.timeTo))} (pausa pranzo esclusa)
                </p>
              )}

              {isFuoriSede && (
                <label className="flex items-center gap-4 p-4 bg-slate-50 border rounded-2xl cursor-pointer mt-3">
                  <input type="checkbox" checked={form.mancataTimbratura} onChange={e => setForm({...form, mancataTimbratura: e.target.checked})} className="w-6 h-6 accent-teal-600" />
                  <div>
                    <p className="font-black text-slate-800 text-sm">Mancata timbratura</p>
                    <p className="text-[11px] text-slate-400 font-bold">Richiede approvazione del responsabile</p>
                  </div>
                </label>
              )}

              {isTrasferta && (
                <div className="mt-3 p-3 bg-blue-50 rounded-2xl border border-blue-100">
                  <p className="text-xs font-black text-blue-600">La trasferta richiede approvazione del responsabile e di Mirco Ronci</p>
                </div>
              )}
            </div>

            <div className="border-t pt-3">
              <label className="text-[10px] font-black text-slate-400 uppercase">Nota (opzionale)</label>
              <textarea
                placeholder="Aggiungi un messaggio per il responsabile..."
                value={form.nota}
                onChange={e => setForm({...form, nota: e.target.value})}
                className="w-full mt-1 p-4 bg-slate-50 border rounded-2xl font-bold outline-none text-sm resize-none"
                rows={2}
              />
            </div>
            <button onClick={handleSend} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-base mt-2">Invia Richiesta</button>
            <button onClick={() => setSelection(null)} className="w-full bg-slate-100 text-slate-400 py-4 rounded-2xl font-black uppercase text-sm">Annulla</button>
          </div>
        </BottomSheet>
      );
    };

    return (
      <div className="pb-2">
        {opts.length > 0 && (
          <div className="mb-4">
            <select value={calFilter} onChange={e => setCalFilter(e.target.value)} className="w-full p-4 bg-white border-2 border-blue-100 rounded-2xl font-black text-blue-600 outline-none text-sm">
              {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
        <div className="bg-white p-3 rounded-3xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setCurrentDate(new Date(year, month - 1))} className="p-3 bg-slate-50 rounded-2xl"><ChevronLeft size={20}/></button>
            <span className="font-black uppercase italic text-sm">{currentDate.toLocaleString('it-IT', { month: 'long', year: 'numeric' })}</span>
            <button onClick={() => setCurrentDate(new Date(year, month + 1))} className="p-3 bg-slate-50 rounded-2xl"><ChevronRight size={20}/></button>
          </div>
          {/* Header giorni */}
          <div className="grid gap-0.5 mb-0.5" style={{gridTemplateColumns: '24px repeat(7, 1fr)'}}>
            <div className="text-center text-[9px] font-black text-slate-300 py-1">W</div>
            {['D','L','M','M','G','V','S'].map((d, i) => <div key={i} className="text-center text-[9px] font-black text-slate-400 py-1 uppercase">{d}</div>)}
          </div>
          {/* Righe settimana */}
          {(() => {
            const cells = [];
            // Riempi le celle: firstDay celle vuote + daysInMonth giorni
            for (let i = 0; i < firstDay; i++) cells.push(null);
            for (let i = 1; i <= daysInMonth; i++) cells.push(i);
            // Aggiungi celle vuote in coda per completare l'ultima riga
            while (cells.length % 7 !== 0) cells.push(null);
            const rows = [];
            for (let r = 0; r < cells.length / 7; r++) rows.push(cells.slice(r * 7, r * 7 + 7));
            return rows.map((row, ri) => {
              // Calcola numero settimana dal LUNEDÌ della riga (ISO: la settimana inizia il lunedì)
              // row[0]=Dom, row[1]=Lun — se lunedì esiste usalo, altrimenti usa il primo giorno reale dopo domenica
              const monday = row[1];
              const firstWeekday = row.slice(1).find(d => d !== null); // primo giorno da lun in poi
              const weekRef = firstWeekday ?? row.find(d => d !== null);
              const weekNum = weekRef ? getISOWeek(new Date(year, month, weekRef)) : null;
              return (
                <div key={ri} className="grid gap-0.5 mb-0.5" style={{gridTemplateColumns: '24px repeat(7, 1fr)'}}>
                  <div className="h-16 flex items-center justify-center">
                    {weekNum && <span className="text-[9px] font-black text-slate-800 leading-none">{weekNum}</span>}
                  </div>
                  {row.map((day, di) => {
                    if (!day) return <div key={di} className="h-16 bg-slate-50/50 rounded-xl"></div>;
                    const dStr = year + '-' + String(month+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
                    const isWeekend = new Date(dStr).getDay() === 0 || new Date(dStr).getDay() === 6;
                    const closure = getClosureForDate(dStr);
                    const dayReqs = visibleRequests.filter(r => r.dates && r.dates.includes(dStr)).slice().sort((a, b) => (a.createdAt||'').localeCompare(b.createdAt||''));
                    let cellBg = 'bg-white';
                    if (isWeekend) cellBg = 'bg-red-50/30';
                    else if (closure) cellBg = closure.contaComeFerie ? 'bg-purple-50' : 'bg-slate-100';
                    return (
                      <div key={di} onClick={() => handleCellClick(dStr, isWeekend, closure, dayReqs)} className={'h-16 border border-slate-100 p-1 rounded-xl transition-all flex flex-col ' + cellBg + ((!isWeekend && !closure && user.role !== 'CEO') ? ' cursor-pointer active:bg-blue-50' : ' cursor-default')}>
                        <span className={'text-[12px] font-bold shrink-0 ' + (isWeekend ? 'text-red-300' : closure ? (closure.contaComeFerie ? 'text-purple-400' : 'text-slate-400') : 'text-slate-400')}>{day}</span>
                        <div className="overflow-y-auto flex-1 space-y-0.5 mt-0.5">
                          {closure && <div className={'text-[7px] px-1 rounded font-black text-white truncate leading-tight py-0.5 ' + (closure.contaComeFerie ? 'bg-purple-400' : 'bg-slate-400')}>Chiusura az.</div>}
                          {dayReqs.map(r => {
                            const sigla = getSigla(r);
                            const reqUser = users.find(u => u.id === r.userId);
                            const displayName = reqUser?.username || r.userName.split(' ')[0];
                            const label = isPersonalView
                              ? getTypeLabel(r.type)
                              : (displayName + (sigla ? ' ' + sigla : ''));
                            return (
                              <div key={r.id} className={'text-[7px] px-1 rounded font-black text-white truncate leading-tight py-0.5 ' + getTypeBadgeColor(r.type, r.status)}>
                                {label}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>

        {/* Legenda */}
        <div className="mt-3 space-y-2">
          <div className="flex gap-3 flex-wrap">
            <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400"><span className="w-3 h-3 rounded bg-green-500 inline-block"></span>Approvato / Malattia</span>
            <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400"><span className="w-3 h-3 rounded bg-orange-500 inline-block"></span>In attesa</span>
            <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400"><span className="w-3 h-3 rounded bg-red-500 inline-block"></span>Rifiutato</span>
            <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400"><span className="w-3 h-3 rounded bg-purple-400 inline-block"></span>Chiusura az.</span>
          </div>
          {!isPersonalView && (
            <div className="flex gap-3 flex-wrap border-t border-slate-100 pt-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-1">Sigle:</span>
              {[['F','Ferie'],['P','Permesso'],['M','Malattia'],['T','Trasferta'],['FS','Fuori sede'],['MR','Mancata marcatura']].map(([s,l]) => (
                <span key={s} className="text-[10px] font-bold text-slate-500"><span className="font-black text-slate-700">{s}</span> = {l}</span>
              ))}
            </div>
          )}
        </div>

        {selection && renderRequestForm()}

        {dayDetailModal && (
          <BottomSheet onClose={() => { setDayDetailModal(null); setDayActionReq(null); setDayActionNote(''); }}>
            <h3 className="text-xl font-black uppercase italic mb-1">Dettaglio giorno</h3>
            <p className="text-xs text-slate-400 font-bold uppercase mb-5">
              {new Date(dayDetailModal.date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <div className="space-y-3">
              {dayDetailModal.reqs.map(r => {
                const canAct = user.role === 'CEO' || user.role === 'amministratore' || r.assignedTo === user.name;
                const isSelected = dayActionReq === r.id;
                const statusColor = r.status === 'approvato' ? 'border-green-500 bg-green-50' : r.status === 'rifiutato' ? 'border-red-400 bg-red-50' : r.status === 'comunicato' ? 'border-teal-500 bg-teal-50' : 'border-orange-400 bg-orange-50';
                const statusLabel = r.status === 'pendente_responsabile' ? 'Att. responsabile' : r.status === 'pendente_mirco' ? 'Att. Mirco' : r.status === 'comunicato' ? 'Comunicato' : r.status === 'approvato' ? '✓ Approvato' : r.status === 'rifiutato' ? '✗ Rifiutato' : r.status;
                const statusTextColor = r.status === 'approvato' ? 'text-green-600' : r.status === 'rifiutato' ? 'text-red-500' : r.status === 'comunicato' ? 'text-teal-600' : 'text-orange-500';
                return (
                  <div key={r.id} className={'rounded-2xl border-l-4 overflow-hidden transition-all ' + statusColor + (canAct ? ' cursor-pointer' : '')}>
                    <div
                      className="p-4"
                      onClick={() => {
                        if (!canAct) return;
                        setDayActionReq(isSelected ? null : r.id);
                        setDayActionNote('');
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-black text-slate-800 text-sm uppercase">{r.userName}</p>
                            {canAct && <span className="text-[9px] text-slate-400 font-bold">{isSelected ? '▲ chiudi' : '▼ gestisci'}</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={'px-2 py-0.5 rounded-full text-[10px] font-black uppercase text-white ' + getTypeBadgeColor(r.type, r.status)}>
                              {getTypeLabel(r.type)}
                            </span>
                            <span className={'text-[10px] font-black uppercase ' + statusTextColor}>{statusLabel}</span>
                          </div>
                          {r.timeFrom && <p className="text-xs text-slate-500 font-bold mt-1">{r.timeFrom} → {r.timeTo} · {formatMinutes(r.durationMinutes || 0)}</p>}
                          {r.mancataTimbratura && <p className="text-[10px] text-teal-600 font-black mt-0.5">⚠ Mancata timbratura</p>}
                          {r.nota && <p className="text-xs text-blue-600 font-bold mt-1 italic">Nota: "{r.nota}"</p>}
                          {r.notaResponsabile && <p className="text-xs text-slate-500 font-bold mt-0.5 italic">Resp.: "{r.notaResponsabile}"</p>}
                        </div>
                      </div>
                    </div>

                    {/* Pannello azioni — visibile solo se selezionato */}
                    {isSelected && canAct && (
                      <div className="px-4 pb-4 space-y-3 border-t border-white/50 pt-3 bg-white/60">
                        <textarea
                          placeholder="Nota opzionale per il dipendente..."
                          value={dayActionNote}
                          onChange={e => setDayActionNote(e.target.value)}
                          className="w-full p-3 bg-white border border-slate-200 rounded-2xl font-bold outline-none text-xs resize-none"
                          rows={2}
                          onClick={e => e.stopPropagation()}
                        />
                        <div className="flex gap-2">
                          {/* Approva (se non già approvato) */}
                          {r.status !== 'approvato' && (
                            <button
                              className="flex-1 flex items-center justify-center gap-1 bg-green-500 text-white py-3 rounded-2xl font-black text-xs uppercase"
                              onClick={async (e) => {
                                e.stopPropagation();
                                await updateDoc(doc(db, 'requests', r.id), { status: 'approvato', ...(dayActionNote ? { notaResponsabile: dayActionNote } : {}) });
                                await writeAuditLog({ action: r.status === 'rifiutato' ? 'rivalutata→approvata' : 'approvata', fromUser: user, toUser: r.userName, type: r.type, nota: dayActionNote });
                                const typeLabel = r.type === 'permesso' ? 'permesso' : r.type === 'trasferta' ? 'trasferta' : r.type === 'fuorisede' ? 'fuori sede' : r.type === 'malattia' ? 'malattia' : 'ferie';
                                const dateInfo = r.dates?.length > 0 ? (r.dates.length === 1 ? ' del ' + formatDate(r.dates[0]) : ' dal ' + formatDate(r.dates[0]) + ' al ' + formatDate(r.dates[r.dates.length-1])) : '';
                                await addDoc(collection(db, 'notifications'), {
                                  to: r.userName,
                                  message: 'Richiesta di ' + typeLabel + dateInfo + ' APPROVATA' + (dayActionNote ? ' — ' + dayActionNote : '') + (r.status === 'rifiutato' ? ' (rivalutazione)' : ''),
                                  date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false
                                });
                                setDayActionReq(null); setDayActionNote('');
                                setDayDetailModal(prev => prev ? { ...prev, reqs: prev.reqs.map(x => x.id === r.id ? { ...x, status: 'approvato', notaResponsabile: dayActionNote } : x) } : null);
                              }}
                            >
                              <CheckCircle size={14}/> {r.status === 'rifiutato' ? 'Rivaluta' : 'Approva'}
                            </button>
                          )}
                          {/* Rifiuta (se non già rifiutato) */}
                          {r.status !== 'rifiutato' && (
                            <button
                              className="flex-1 flex items-center justify-center gap-1 bg-red-500 text-white py-3 rounded-2xl font-black text-xs uppercase"
                              onClick={async (e) => {
                                e.stopPropagation();
                                await updateDoc(doc(db, 'requests', r.id), { status: 'rifiutato', ...(dayActionNote ? { notaResponsabile: dayActionNote } : {}) });
                                await writeAuditLog({ action: 'rifiutata', fromUser: user, toUser: r.userName, type: r.type, nota: dayActionNote });
                                const typeLabel = r.type === 'permesso' ? 'permesso' : r.type === 'trasferta' ? 'trasferta' : r.type === 'fuorisede' ? 'fuori sede' : r.type === 'malattia' ? 'malattia' : 'ferie';
                                const dateInfo = r.dates?.length > 0 ? (r.dates.length === 1 ? ' del ' + formatDate(r.dates[0]) : ' dal ' + formatDate(r.dates[0]) + ' al ' + formatDate(r.dates[r.dates.length-1])) : '';
                                await addDoc(collection(db, 'notifications'), {
                                  to: r.userName,
                                  message: 'Richiesta di ' + typeLabel + dateInfo + ' RIFIUTATA' + (dayActionNote ? ' — ' + dayActionNote : ''),
                                  date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false
                                });
                                setDayActionReq(null); setDayActionNote('');
                                setDayDetailModal(prev => prev ? { ...prev, reqs: prev.reqs.map(x => x.id === r.id ? { ...x, status: 'rifiutato', notaResponsabile: dayActionNote } : x) } : null);
                              }}
                            >
                              <XCircle size={14}/> Rifiuta
                            </button>
                          )}
                          {/* Se già approvato: mostra solo rifiuta */}
                          {/* Se già rifiutato: mostra solo approva (rivaluta) */}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button onClick={() => { setDayDetailModal(null); setDayActionReq(null); setDayActionNote(''); }} className="w-full bg-slate-100 text-slate-400 py-4 rounded-2xl font-black uppercase text-sm mt-5">Chiudi</button>
          </BottomSheet>
        )}

        {/* ✅ FIX: guardia recipientModal aggiunta — era null al login e causava il crash */}
        {recipientModal && (
          <BottomSheet>
            <h3 className="text-xl font-black uppercase italic mb-2">Invia a chi?</h3>
            <p className="text-sm text-slate-400 font-bold mb-6">Scegli il destinatario della richiesta</p>
            <div className="space-y-3">
              <button onClick={() => doSendFerie(recipientModal.resp1)} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-base">{recipientModal.resp1}</button>
              <button onClick={() => doSendFerie('Mirco Ronci')} className="w-full bg-slate-800 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-base">Mirco Ronci</button>
              <button onClick={() => setRecipientModal(null)} className="w-full bg-slate-100 text-slate-400 py-4 rounded-2xl font-black uppercase text-sm">Annulla</button>
            </div>
          </BottomSheet>
        )}

        {reqModal && (
          <BottomSheet>
            {!modifyMode ? (
              <>
                <h3 className="text-xl font-black uppercase italic mb-1">La tua richiesta</h3>
                <p className="text-xs text-slate-400 font-bold uppercase mb-1">{getTypeLabel(reqModal.type)}</p>
                {reqModal.timeFrom ? (
                  <p className="text-xs text-slate-500 font-bold mb-2">{reqModal.dates?.[0]} · {reqModal.timeFrom} - {reqModal.timeTo} · {formatMinutes(reqModal.durationMinutes || 0)}</p>
                ) : (
                  <p className="text-xs text-slate-500 font-bold mb-2">{reqModal.dates?.length} giorni</p>
                )}
                <div className="mb-5 space-y-2">
                  <p className="text-xs font-black">
                    <span className={
                      reqModal.status === 'approvato' || reqModal.status === 'comunicato' ? 'text-green-500' :
                      reqModal.status === 'rifiutato' ? 'text-red-500' : 'text-orange-500'
                    }>
                      {reqModal.status === 'pendente_responsabile' ? 'In attesa responsabile' :
                       reqModal.status === 'pendente_mirco' ? 'In attesa Mirco' :
                       reqModal.status === 'comunicato' ? 'Comunicato' :
                       reqModal.status === 'approvato' ? '✓ Approvato' :
                       reqModal.status === 'rifiutato' ? '✗ Rifiutato' :
                       reqModal.status}
                    </span>
                  </p>
                  {reqModal.notaResponsabile && (
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                      <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Nota del responsabile</p>
                      <p className="text-sm font-bold text-slate-700 italic">"{reqModal.notaResponsabile}"</p>
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  {reqModal.type !== 'fuorisede' && reqModal.type !== 'permesso' && (
                    <button onClick={() => setModifyMode(true)} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 text-base"><Edit3 size={18}/> Modifica</button>
                  )}
                  <button onClick={() => handleCancel(reqModal)} className="w-full bg-red-500 text-white py-5 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 text-base"><Trash2 size={18}/> Cancella</button>
                  <button onClick={() => setReqModal(null)} className="w-full bg-slate-100 text-slate-400 py-4 rounded-2xl font-black uppercase text-sm">Chiudi</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-xl font-black uppercase italic mb-5">Modifica richiesta</h3>
                <div className="space-y-3">
                  <div><label className="text-[10px] font-black text-slate-400 uppercase">Data inizio</label><input type="date" value={modifyForm.start} onChange={e => setModifyForm({...modifyForm, start: e.target.value})} className="w-full p-4 bg-slate-50 border rounded-2xl font-bold mt-1 text-base" /></div>
                  <div><label className="text-[10px] font-black text-slate-400 uppercase">Data fine</label><input type="date" value={modifyForm.end} onChange={e => setModifyForm({...modifyForm, end: e.target.value})} className="w-full p-4 bg-slate-50 border rounded-2xl font-bold mt-1 text-base" /></div>
                  <button onClick={() => handleModify(reqModal)} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-base">Salva modifiche</button>
                  <button onClick={() => setModifyMode(false)} className="w-full bg-slate-100 text-slate-400 py-4 rounded-2xl font-black uppercase text-sm">Indietro</button>
                </div>
              </>
            )}
          </BottomSheet>
        )}
      </div>
    );
  };

  const NotificationsView = () => {
    const [approvalNotes, setApprovalNotes] = useState({});
    const myPending = requests.filter(r => r.assignedTo === user.name && (r.status === 'pendente' || r.status === 'pendente_responsabile' || r.status === 'pendente_mirco'));
    const myHistory = notifications.filter(n => n.to === user.name);

    const resolve = async (req, status) => {
      if (req.type === 'trasferta' && status === 'approvato' && req.status === 'pendente_responsabile') {
        await updateDoc(doc(db, 'requests', req.id), { status: 'pendente_mirco', assignedTo: 'Mirco Ronci' });
        const trDateInfo = req.dates && req.dates.length > 0
          ? ' dal ' + formatDate(req.dates[0]) + ' al ' + formatDate(req.dates[req.dates.length - 1])
          : '';
        await addDoc(collection(db, 'notifications'), {
          to: 'Mirco Ronci',
          message: 'Trasferta di ' + req.userName + trDateInfo + ' approvata dal responsabile. In attesa della tua approvazione.',
          date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), requestId: req.id, read: false
        });
        await addDoc(collection(db, 'notifications'), {
          to: req.userName,
          message: 'La tua trasferta' + trDateInfo + ' è stata approvata dal responsabile. In attesa di approvazione da Mirco Ronci.',
          date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false
        });
        return;
      }
      await updateDoc(doc(db, 'requests', req.id), {
        status,
        ...(approvalNotes[req.id] ? { notaResponsabile: approvalNotes[req.id] } : {})
      });
      await writeAuditLog({ action: status, fromUser: user, toUser: req.userName, type: req.type, nota: approvalNotes[req.id] || '' });
      await addDoc(collection(db, 'notifications'), {
        to: req.userName,
        message: (() => {
          const typeLabel = req.type === 'trasferta' ? 'trasferta' : req.type === 'permesso' ? 'permesso' : req.type === 'fuorisede' ? 'fuori sede' : req.type === 'malattia' ? 'malattia' : 'ferie';
          const dateInfo = req.dates && req.dates.length > 0
            ? (req.dates.length === 1 ? ' del ' + formatDate(req.dates[0]) : ' dal ' + formatDate(req.dates[0]) + ' al ' + formatDate(req.dates[req.dates.length - 1]) + ' (' + req.dates.length + ' gg)')
            : '';
          const statusLabel = status === 'approvato' ? 'APPROVATA' : 'RIFIUTATA';
          const nota = approvalNotes[req.id] || '';
          return 'Richiesta di ' + typeLabel + dateInfo + ' ' + statusLabel + (nota ? ' — ' + nota : '');
        })(),
        date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false
      });
    };

    const approveFuoriSede = async (req) => {
      await updateDoc(doc(db, 'requests', req.id), { status: 'approvato' });
      await writeAuditLog({ action: 'approvata', fromUser: user, toUser: req.userName, type: 'fuorisede' });
      await addDoc(collection(db, 'notifications'), {
        to: req.userName,
        message: 'Mancata timbratura del ' + formatDate(req.dates?.[0]) + ' APPROVATA.',
        date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false
      });
    };

    const getPendingLabel = (req) => {
      if (req.type === 'trasferta') return req.status === 'pendente_responsabile' ? 'Trasferta (step 1/2)' : 'Trasferta (step 2/2)';
      if (req.type === 'fuorisede') return 'Fuori sede - Mancata timbratura';
      return req.type + ': ' + (req.dates?.length || 0) + ' giorni';
    };

    return (
      <div className="space-y-4 pb-6">
        <h2 className="text-xl font-black uppercase italic">Centro Notifiche</h2>
        {myPending.length === 0 && <p className="text-slate-400 text-sm font-bold">Nessuna richiesta in attesa.</p>}
        {myPending.map(r => (
          <div key={r.id} className="bg-white p-5 rounded-3xl border-2 border-blue-100 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-black text-slate-800 uppercase text-sm">{r.userName}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">{getPendingLabel(r)}</p>
                {r.timeFrom && <p className="text-[10px] font-bold text-slate-500 mt-0.5">{r.dates?.[0]} · {r.timeFrom} - {r.timeTo}</p>}
                {r.nota && <p className="text-xs text-blue-600 font-bold mt-1 italic">"{r.nota}"</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                {r.type === 'fuorisede' && r.mancataTimbratura ? (
                  <button onClick={() => approveFuoriSede(r)} className="p-4 bg-teal-500 text-white rounded-2xl"><CheckCircle size={20}/></button>
                ) : (
                  <>
                    <button onClick={() => resolve(r, 'approvato')} className="p-4 bg-green-500 text-white rounded-2xl"><CheckCircle size={20}/></button>
                    <button onClick={() => resolve(r, 'rifiutato')} className="p-4 bg-red-500 text-white rounded-2xl"><XCircle size={20}/></button>
                  </>
                )}
              </div>
            </div>
            <textarea
              placeholder="Nota opzionale (visibile al dipendente)..."
              value={approvalNotes[r.id] || ''}
              onChange={e => setApprovalNotes(n => ({...n, [r.id]: e.target.value}))}
              className="w-full p-3 bg-slate-50 border rounded-2xl font-bold outline-none text-xs resize-none"
              rows={2}
            />
          </div>
        ))}
        {/* Richieste rifiutate — possibilità di rivalutare */}
        {requests.filter(r => r.assignedTo === user.name && r.status === 'rifiutato').length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">Richieste rifiutate — Rivaluta</p>
            {requests.filter(r => r.assignedTo === user.name && r.status === 'rifiutato').map(r => (
              <div key={r.id} className="bg-white p-5 rounded-3xl border-2 border-red-100 shadow-sm space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-black text-slate-800 uppercase text-sm">{r.userName}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">{r.type} · {r.dates?.length || 0} giorni</p>
                    {r.dates?.[0] && <p className="text-[10px] font-bold text-slate-500 mt-0.5">{formatDate(r.dates[0])}{r.dates.length > 1 ? ' → ' + formatDate(r.dates[r.dates.length-1]) : ''}</p>}
                    {r.notaResponsabile && <p className="text-xs text-red-400 font-bold mt-1 italic">Nota precedente: "{r.notaResponsabile}"</p>}
                  </div>
                  <button
                    onClick={async () => {
                      if (!window.confirm('Vuoi approvare questa richiesta precedentemente rifiutata?')) return;
                      await updateDoc(doc(db, 'requests', r.id), { status: 'approvato', notaResponsabile: '' });
                      await writeAuditLog({ action: 'rivalutata→approvata', fromUser: user, toUser: r.userName, type: r.type });
                      await addDoc(collection(db, 'notifications'), {
                        to: r.userName,
                        message: (() => {
                          const typeLabel = r.type === 'trasferta' ? 'trasferta' : r.type === 'permesso' ? 'permesso' : r.type === 'fuorisede' ? 'fuori sede' : 'ferie';
                          const dateInfo = r.dates?.length > 0 ? (r.dates.length === 1 ? ' del ' + formatDate(r.dates[0]) : ' dal ' + formatDate(r.dates[0]) + ' al ' + formatDate(r.dates[r.dates.length-1])) : '';
                          return 'Richiesta di ' + typeLabel + dateInfo + ' APPROVATA (rivalutazione)';
                        })(),
                        date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false
                      });
                    }}
                    className="shrink-0 flex items-center gap-2 bg-green-500 text-white px-4 py-3 rounded-2xl font-black text-xs uppercase"
                  >
                    <RefreshCw size={16}/> Approva
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-3xl border p-5 space-y-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-3">Cronologia</p>
          {myHistory.length === 0 && <p className="text-slate-400 text-sm font-bold">Nessuna notifica.</p>}
          {myHistory.map(n => {
            const isAlert = n.message && n.message.startsWith('ATTENZIONE!!!');
            return (
              <div key={n.id} className={'flex gap-3 border-b pb-3 last:border-0 ' + (isAlert ? 'border-red-100 bg-red-50 rounded-2xl px-3 py-2' : 'border-slate-50')}>
                <div className={'w-2 h-2 rounded-full mt-1.5 shrink-0 ' + (isAlert ? 'bg-red-500' : 'bg-blue-500')}></div>
                <div>
                  <p className={'text-sm font-bold ' + (isAlert ? 'text-red-600' : 'text-slate-700')}>{n.message}</p>
                  <p className="text-[9px] font-black text-slate-400 uppercase mt-0.5">{n.date}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const LogView = () => {
    const [filters, setFilters] = useState({ username: '', date: '', recipient: '', type: '', action: '' });
    const [sortCol, setSortCol] = useState('code');
    const [sortDir, setSortDir] = useState('desc');

    const handleClearLog = async () => {
      if (!window.confirm('Cancellare tutto il registro operazioni?')) return;
      const snap = await getDocs(collection(db, 'auditLog'));
      await Promise.all(snap.docs.map(d => deleteDoc(doc(db, 'auditLog', d.id))));
    };

    const actionLabel = (a) => {
      const map = { inviata: '📤 Inviata', approvata: '✅ Approvata', rifiutata: '❌ Rifiutata', cancellata: '🗑 Cancellata', modificata: '✏️ Modificata', 'rivalutata→approvata': '🔄 Rivalutata→Appr.' };
      return map[a] || a;
    };

    const handleSort = (col) => {
      if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
      else { setSortCol(col); setSortDir('asc'); }
    };

    const SortIcon = ({ col }) => {
      if (sortCol !== col) return <span className="text-slate-300 ml-1">↕</span>;
      return <span className="text-blue-500 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
    };

    const filtered = auditLogs
      .filter(l =>
        (!filters.username || (l.username||'').toLowerCase().includes(filters.username.toLowerCase())) &&
        (!filters.date     || (l.date||'').includes(filters.date)) &&
        (!filters.recipient|| (l.recipient||'').toLowerCase().includes(filters.recipient.toLowerCase())) &&
        (!filters.type     || (l.type||'').toLowerCase().includes(filters.type.toLowerCase())) &&
        (!filters.action   || (l.action||'').toLowerCase().includes(filters.action.toLowerCase()))
      )
      .sort((a, b) => {
        const va = (a[sortCol] || '').toString();
        const vb = (b[sortCol] || '').toString();
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      });

    const FilterInput = ({ col, placeholder }) => (
      <input
        type="text"
        value={filters[col]}
        onChange={e => setFilters(f => ({ ...f, [col]: e.target.value }))}
        placeholder={placeholder}
        className="w-full mt-1 p-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-bold outline-none placeholder-slate-300"
      />
    );

    const hasFilters = Object.values(filters).some(v => v !== '');

    return (
      <div className="space-y-4 pb-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black uppercase italic">Registro Operazioni</h2>
          <div className="flex gap-2">
            {hasFilters && (
              <button onClick={() => setFilters({ username: '', date: '', recipient: '', type: '', action: '' })}
                className="flex items-center gap-1 bg-slate-100 text-slate-500 px-3 py-2 rounded-2xl font-black uppercase text-xs">
                <X size={12}/> Reset filtri
              </button>
            )}
            <button onClick={handleClearLog} className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-2xl font-black uppercase text-xs">
              <Trash2 size={14}/> Svuota
            </button>
          </div>
        </div>

        <p className="text-[10px] font-bold text-slate-400">
          {filtered.length} di {auditLogs.length} operazioni
          {hasFilters && ' (filtrate)'}
        </p>

        {auditLogs.length === 0 && <p className="text-slate-400 text-sm font-bold text-center py-8">Nessuna operazione registrata.</p>}

        <div className="bg-white rounded-3xl border overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{minWidth: '750px'}}>
              <thead className="bg-slate-50 border-b">
                <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  {/* Codice — solo sort */}
                  <th className="p-3 cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort('code')}>
                    Codice <SortIcon col="code"/>
                  </th>
                  {/* Username */}
                  <th className="p-3 min-w-[110px]">
                    <div className="cursor-pointer select-none" onClick={() => handleSort('username')}>Username <SortIcon col="username"/></div>
                    <FilterInput col="username" placeholder="Filtra..."/>
                  </th>
                  {/* Data */}
                  <th className="p-3 min-w-[100px]">
                    <div className="cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort('date')}>Data <SortIcon col="date"/></div>
                    <FilterInput col="date" placeholder="gg/mm/aaaa"/>
                  </th>
                  {/* Orario */}
                  <th className="p-3 cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort('time')}>
                    Orario <SortIcon col="time"/>
                  </th>
                  {/* Destinatario */}
                  <th className="p-3 min-w-[110px]">
                    <div className="cursor-pointer select-none" onClick={() => handleSort('recipient')}>Destinatario <SortIcon col="recipient"/></div>
                    <FilterInput col="recipient" placeholder="Filtra..."/>
                  </th>
                  {/* Tipo */}
                  <th className="p-3 min-w-[90px]">
                    <div className="cursor-pointer select-none" onClick={() => handleSort('type')}>Tipo <SortIcon col="type"/></div>
                    <FilterInput col="type" placeholder="ferie..."/>
                  </th>
                  {/* Azione */}
                  <th className="p-3 min-w-[120px]">
                    <div className="cursor-pointer select-none" onClick={() => handleSort('action')}>Azione <SortIcon col="action"/></div>
                    <FilterInput col="action" placeholder="appr..."/>
                  </th>
                  {/* Nota */}
                  <th className="p-3">Nota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="p-6 text-center text-slate-400 text-sm font-bold">Nessun risultato per i filtri applicati.</td></tr>
                )}
                {filtered.map(l => (
                  <tr key={l.id} className="hover:bg-slate-50/50 text-xs">
                    <td className="p-3 font-mono text-[9px] text-slate-500 whitespace-nowrap">{l.code}</td>
                    <td className="p-3 font-black text-slate-800 uppercase">{l.username}</td>
                    <td className="p-3 font-bold text-slate-600 whitespace-nowrap">{l.date}</td>
                    <td className="p-3 font-bold text-slate-600 whitespace-nowrap">{l.time}</td>
                    <td className="p-3 font-bold text-slate-600">{l.recipient}</td>
                    <td className="p-3"><span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-[9px] font-black uppercase">{l.type}</span></td>
                    <td className="p-3 whitespace-nowrap font-bold text-slate-700">{actionLabel(l.action)}</td>
                    <td className="p-3 text-slate-500 italic max-w-[150px] truncate">{l.nota || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center"><p className="text-white font-black text-xl animate-pulse">Caricamento...</p></div>;

  if (!user) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl w-full max-w-sm text-slate-800">
        <h1 className="text-3xl font-black italic text-center mb-8 tracking-tighter uppercase">HR PORTAL</h1>
        <div className="space-y-4">
          <input id="un" type="text" placeholder="Username" className="w-full p-5 bg-slate-50 border rounded-2xl outline-none font-bold text-base" autoCapitalize="none" />
          <input id="pw" type="password" placeholder="Password" className="w-full p-5 bg-slate-50 border rounded-2xl outline-none font-bold text-base" />
          <button className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-lg text-base" onClick={() => {
            const u = document.getElementById('un').value;
            const p = document.getElementById('pw').value;
            const f = users.find(x => x.username === u && x.password === p);
            if (f) setUser(f); else alert('Credenziali non valide');
          }}>Accedi</button>
        </div>
      </div>
    </div>
  );

  const pendingCount = requests.filter(r => r.assignedTo === user.name && (r.status === 'pendente' || r.status === 'pendente_responsabile' || r.status === 'pendente_mirco')).length;
  const showAdmin = user.role === 'amministratore' || user.role === 'CEO';

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col">
      <header className="fixed top-0 left-0 right-0 bg-slate-900 text-white px-5 py-3 flex items-center justify-between z-30 shadow-lg">
        <h2 className="text-lg font-black italic uppercase tracking-tighter">Mirco Portal</h2>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="font-black text-xs uppercase leading-tight">{user.name}</p>
            <p className="text-[10px] text-blue-400 font-bold uppercase">{user.role}</p>
          </div>
          <button onClick={() => setUser(null)} className="p-2 text-red-400"><LogOut size={20}/></button>
        </div>
      </header>
      <main className="flex-1 pt-16 pb-24 px-4 overflow-y-auto">
        <div className="max-w-2xl mx-auto pt-5">
          {view === 'calendar' && <CalendarView />}
          {view === 'notifications' && <NotificationsView />}
          {view === 'users' && showAdmin && <AdminUsersView />}
          {view === 'closures' && showAdmin && <ClosuresView />}
          {view === 'log' && showAdmin && <LogView />}
        </div>
      </main>
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 text-white flex z-30 border-t border-slate-800">
        <button onClick={() => setView('calendar')} className={'flex-1 flex flex-col items-center justify-center py-3 gap-1 ' + (view === 'calendar' ? 'text-blue-400' : 'text-slate-500')}>
          <Calendar size={22}/><span className="text-[10px] font-black uppercase">Calendario</span>
        </button>
        <button onClick={() => setView('notifications')} className={'flex-1 flex flex-col items-center justify-center py-3 gap-1 relative ' + (view === 'notifications' ? 'text-blue-400' : 'text-slate-500')}>
          <Bell size={22}/><span className="text-[10px] font-black uppercase">Notifiche</span>
          {pendingCount > 0 && <span className="absolute top-2 right-[calc(50%-20px)] bg-red-500 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[9px] font-black px-1">{pendingCount}</span>}
        </button>
        {showAdmin && (
          <button onClick={() => setView('users')} className={'flex-1 flex flex-col items-center justify-center py-3 gap-1 ' + (view === 'users' ? 'text-blue-400' : 'text-slate-500')}>
            <Users size={22}/><span className="text-[10px] font-black uppercase">Collaboratori</span>
          </button>
        )}
        {showAdmin && (
          <button onClick={() => setView('closures')} className={'flex-1 flex flex-col items-center justify-center py-3 gap-1 ' + (view === 'closures' ? 'text-blue-400' : 'text-slate-500')}>
            <Building2 size={22}/><span className="text-[10px] font-black uppercase">Chiusure</span>
          </button>
        )}
        {showAdmin && (
          <button onClick={() => setView('log')} className={'flex-1 flex flex-col items-center justify-center py-3 gap-1 ' + (view === 'log' ? 'text-blue-400' : 'text-slate-500')}>
            <ClipboardList size={22}/><span className="text-[10px] font-black uppercase">Registro</span>
          </button>
        )}
      </nav>
    </div>
  );
}
