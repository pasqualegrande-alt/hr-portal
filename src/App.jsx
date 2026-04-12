import React, { useState, useEffect } from 'react';
import { Calendar, Users, Bell, LogOut, ChevronLeft, ChevronRight, Trash2, Edit3, CheckCircle, XCircle, UserPlus, Save, X, Building2, GitBranch } from 'lucide-react';
import { db, getMessagingInstance } from './firebase';
import { collection, doc, setDoc, getDocs, onSnapshot, deleteDoc, updateDoc, addDoc, query, orderBy } from 'firebase/firestore';
import { getToken, onMessage } from 'firebase/messaging';

const VAPID_KEY = 'BLTQzNLfMk1VJP8rUl7tnYmgvFP0s6Yv4LN6Ao9V7S6kaphS0aqE52O8Jdxt74UoPVV-x2hsFeJBzGyonAmWefI';

const INITIAL_USERS = [
  { id: '1', firstName: 'Mirco', lastName: 'Ronci', name: 'Mirco Ronci', username: 'mirco.ceo', password: '123', role: 'CEO' },
  { id: '2', firstName: 'Admin', lastName: 'User', name: 'Admin User', username: 'admin', password: '123', role: 'amministratore' },
  { id: '3', firstName: 'Silvia', lastName: 'Cori', name: 'Silvia Cori', username: 's.cori', password: '123', role: 'dipendente', resp1: '', resp2: '/' },
];

const POLIVALENZA_MSG = 'ATTENZIONE!!! DEI DIPENDENTI CON MANSIONI EQUIVALENTI STANNO CHIEDENDO LE FERIE NELLO STESSO PERIODO. VERIFICA PRIMA DI APPROVARE PER EVITARE DI LASCIARE SCOPERTA UNA O PIÙ FUNZIONI!';

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
    return () => { unsubUsers(); unsubReqs(); unsubNotifs(); unsubClosures(); unsubPoli(); };
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
        const allInvolved = [submittingUser, ...overlapping.map(r => users.find(u => u.name === r.userName)).filter(Boolean)];
        for (const u of allInvolved) {
          if (u.resp1 && u.resp1 !== '/') responsibles.add(u.resp1);
          if (u.resp2 === 'Mirco Ronci') responsibles.add('Mirco Ronci');
        }
        if (responsibles.size === 0) responsibles.add('Mirco Ronci');
        for (const resp of responsibles) {
          await addDoc(collection(db, 'notifications'), {
            to: resp, message: POLIVALENZA_MSG,
            date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false,
          });
        }
      }
    }
  };

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
    const [calFilter, setCalFilter] = useState('mine');
    const [selection, setSelection] = useState(null);
    const [form, setForm] = useState({ end: '', type: 'ferie' });
    const [reqModal, setReqModal] = useState(null);
    const [modifyMode, setModifyMode] = useState(false);
    const [modifyForm, setModifyForm] = useState({ start: '', end: '', type: 'ferie' });
    const [recipientModal, setRecipientModal] = useState(null);

    const month = currentDate.getMonth();
    const year = currentDate.getFullYear();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const subordinates = users.filter(u => u.resp1 === user.name);

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

    const doSend = async (assignedTo) => {
      const dates = buildDates(selection, form.end);
      if (dates.length === 0) return alert('Seleziona giorni lavorativi');
      const newReq = { userId: user.id, userName: user.name, type: form.type, dates, status: form.type === 'malattia' ? 'approvato' : 'pendente', assignedTo, createdAt: new Date().toISOString() };
      const reqRef = await addDoc(collection(db, 'requests'), newReq);
      if (newReq.status === 'pendente') {
        await addDoc(collection(db, 'notifications'), { to: assignedTo, message: 'Richiesta ' + form.type + ' da ' + user.name, date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), requestId: reqRef.id, read: false });
      }
      await checkPolivalenza(dates, user);
      setSelection(null); setRecipientModal(null);
    };

    const handleSend = async () => {
      const dates = buildDates(selection, form.end);
      if (dates.length === 0) return alert('Seleziona giorni lavorativi');
      const resp1 = user.resp1 && user.resp1 !== '/' ? user.resp1 : null;
      const resp2 = user.resp2 === 'Mirco Ronci' ? 'Mirco Ronci' : null;
      if (resp1 && resp2) { setRecipientModal({ resp1, resp2 }); return; }
      await doSend(resp1 || resp2 || 'Mirco Ronci');
    };

    const handleCancel = async (req) => {
      if (!window.confirm('Vuoi davvero cancellare questa richiesta?')) return;
      await deleteDoc(doc(db, 'requests', req.id));
      await addDoc(collection(db, 'notifications'), { to: req.assignedTo, message: 'ATTENZIONE! IL DIPENDENTE ' + user.name + ' HA CANCELLATO LE SUE FERIE', date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false });
      setReqModal(null);
    };

    const handleModify = async (req) => {
      const dates = buildDates(modifyForm.start || req.dates[0], modifyForm.end);
      if (dates.length === 0) return alert('Seleziona giorni lavorativi');
      await updateDoc(doc(db, 'requests', req.id), { dates, type: modifyForm.type, status: modifyForm.type === 'malattia' ? 'approvato' : 'pendente', updatedAt: new Date().toISOString() });
      await addDoc(collection(db, 'notifications'), { to: req.assignedTo, message: 'ATTENZIONE! IL DIPENDENTE ' + user.name + ' HA MODIFICATO LE SUE FERIE', date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false });
      setReqModal(null); setModifyMode(false);
    };

    const handleCellClick = (dStr, isWeekend, closure, dayReqs) => {
      if (isWeekend || closure || user.role === 'CEO') return;
      const myReq = dayReqs.find(r => r.userId === user.id);
      if (myReq) {
        setReqModal(myReq); setModifyMode(false);
        setModifyForm({ start: myReq.dates[0], end: myReq.dates[myReq.dates.length - 1], type: myReq.type });
      } else {
        setForm({ end: '', type: 'ferie' }); setSelection(dStr);
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

    const BottomSheet = ({ children }) => (
      <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-end justify-center z-50">
        <div className="bg-white p-6 rounded-t-[2.5rem] w-full max-w-lg shadow-2xl text-slate-800 pb-10">
          <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-6"></div>
          {children}
        </div>
      </div>
    );

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
          <div className="grid grid-cols-7 gap-0.5">
            {['D','L','M','M','G','V','S'].map((d, i) => <div key={i} className="text-center text-[9px] font-black text-slate-400 py-1 uppercase">{d}</div>)}
            {[...Array(firstDay)].map((_, i) => <div key={i} className="h-16 bg-slate-50/50 rounded-xl"></div>)}
            {[...Array(daysInMonth)].map((_, i) => {
              const dStr = year + '-' + String(month+1).padStart(2,'0') + '-' + String(i+1).padStart(2,'0');
              const isWeekend = new Date(dStr).getDay() === 0 || new Date(dStr).getDay() === 6;
              const closure = getClosureForDate(dStr);
              const dayReqs = visibleRequests.filter(r => r.dates && r.dates.includes(dStr)).slice().sort((a, b) => (a.createdAt||'').localeCompare(b.createdAt||''));
              let cellBg = 'bg-white';
              if (isWeekend) cellBg = 'bg-red-50/30';
              else if (closure) cellBg = closure.contaComeFerie ? 'bg-purple-50' : 'bg-slate-100';
              return (
                <div key={i} onClick={() => handleCellClick(dStr, isWeekend, closure, dayReqs)} className={'h-16 border border-slate-100 p-1 rounded-xl transition-all flex flex-col ' + cellBg + ((!isWeekend && !closure && user.role !== 'CEO') ? ' cursor-pointer active:bg-blue-50' : ' cursor-default')}>
                  <span className={'text-[10px] font-bold shrink-0 ' + (isWeekend ? 'text-red-300' : closure ? (closure.contaComeFerie ? 'text-purple-400' : 'text-slate-400') : 'text-slate-400')}>{i+1}</span>
                  <div className="overflow-y-auto flex-1 space-y-0.5 mt-0.5">
                    {closure && <div className={'text-[7px] px-1 rounded font-black text-white truncate leading-tight py-0.5 ' + (closure.contaComeFerie ? 'bg-purple-400' : 'bg-slate-400')}>{closure.descrizione || 'Chiusura'}</div>}
                    {dayReqs.map(r => (
                      <div key={r.id} className={'text-[7px] px-1 rounded font-black text-white truncate leading-tight py-0.5 ' + (r.status === 'approvato' ? 'bg-green-500' : 'bg-orange-500')}>
                        {r.userName.split(' ')[0]}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex gap-3 mt-3 flex-wrap">
          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400"><span className="w-3 h-3 rounded bg-green-500 inline-block"></span>Approvato</span>
          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400"><span className="w-3 h-3 rounded bg-orange-500 inline-block"></span>In attesa</span>
          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400"><span className="w-3 h-3 rounded bg-purple-400 inline-block"></span>Chiusura (ferie)</span>
          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400"><span className="w-3 h-3 rounded bg-slate-400 inline-block"></span>Festività</span>
        </div>

        {selection && (
          <BottomSheet>
            <h3 className="text-xl font-black uppercase italic mb-5">Pianifica</h3>
            <div className="space-y-3">
              <div><label className="text-[10px] font-black text-slate-400 uppercase">Data inizio</label><input type="date" value={selection} readOnly className="w-full p-4 bg-slate-50 border rounded-2xl font-bold mt-1 text-base" /></div>
              <div><label className="text-[10px] font-black text-slate-400 uppercase">Data fine (opzionale)</label><input type="date" onChange={e => setForm({...form, end: e.target.value})} className="w-full p-4 bg-slate-50 border rounded-2xl font-bold mt-1 text-base" /></div>
              <select onChange={e => setForm({...form, type: e.target.value})} className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-base">
                <option value="ferie">Ferie</option><option value="permesso">Permesso</option><option value="malattia">Malattia</option>
              </select>
              <button onClick={handleSend} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-base">Invia Richiesta</button>
              <button onClick={() => setSelection(null)} className="w-full bg-slate-100 text-slate-400 py-4 rounded-2xl font-black uppercase text-sm">Annulla</button>
            </div>
          </BottomSheet>
        )}

        {recipientModal && (
          <BottomSheet>
            <h3 className="text-xl font-black uppercase italic mb-2">Invia a chi?</h3>
            <p className="text-sm text-slate-400 font-bold mb-6">Scegli il destinatario della richiesta</p>
            <div className="space-y-3">
              <button onClick={() => doSend(recipientModal.resp1)} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-base">{recipientModal.resp1}</button>
              <button onClick={() => doSend('Mirco Ronci')} className="w-full bg-slate-800 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-base">Mirco Ronci</button>
              <button onClick={() => setRecipientModal(null)} className="w-full bg-slate-100 text-slate-400 py-4 rounded-2xl font-black uppercase text-sm">Annulla</button>
            </div>
          </BottomSheet>
        )}

        {reqModal && (
          <BottomSheet>
            {!modifyMode ? (
              <>
                <h3 className="text-xl font-black uppercase italic mb-1">La tua richiesta</h3>
                <p className="text-xs text-slate-400 font-bold uppercase mb-5">{reqModal.type} · {reqModal.dates?.length} giorni · <span className={reqModal.status === 'approvato' ? 'text-green-500' : 'text-orange-500'}>{reqModal.status}</span></p>
                <div className="space-y-3">
                  <button onClick={() => setModifyMode(true)} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 text-base"><Edit3 size={18}/> Modifica</button>
                  <button onClick={() => handleCancel(reqModal)} className="w-full bg-red-500 text-white py-5 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 text-base"><Trash2 size={18}/> Cancella richiesta</button>
                  <button onClick={() => setReqModal(null)} className="w-full bg-slate-100 text-slate-400 py-4 rounded-2xl font-black uppercase text-sm">Chiudi</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-xl font-black uppercase italic mb-5">Modifica richiesta</h3>
                <div className="space-y-3">
                  <div><label className="text-[10px] font-black text-slate-400 uppercase">Data inizio</label><input type="date" value={modifyForm.start} onChange={e => setModifyForm({...modifyForm, start: e.target.value})} className="w-full p-4 bg-slate-50 border rounded-2xl font-bold mt-1 text-base" /></div>
                  <div><label className="text-[10px] font-black text-slate-400 uppercase">Data fine</label><input type="date" value={modifyForm.end} onChange={e => setModifyForm({...modifyForm, end: e.target.value})} className="w-full p-4 bg-slate-50 border rounded-2xl font-bold mt-1 text-base" /></div>
                  <select value={modifyForm.type} onChange={e => setModifyForm({...modifyForm, type: e.target.value})} className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-base">
                    <option value="ferie">Ferie</option><option value="permesso">Permesso</option><option value="malattia">Malattia</option>
                  </select>
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
    const myPending = requests.filter(r => r.assignedTo === user.name && r.status === 'pendente');
    const myHistory = notifications.filter(n => n.to === user.name);
    const resolve = async (id, status) => {
      await updateDoc(doc(db, 'requests', id), { status });
      const req = requests.find(r => r.id === id);
      if (req) await addDoc(collection(db, 'notifications'), { to: req.userName, message: 'Richiesta ' + status.toUpperCase() + ' dal responsabile', date: new Date().toLocaleString('it-IT'), createdAt: new Date().toISOString(), read: false });
    };
    return (
      <div className="space-y-4 pb-6">
        <h2 className="text-xl font-black uppercase italic">Centro Notifiche</h2>
        {myPending.length === 0 && <p className="text-slate-400 text-sm font-bold">Nessuna richiesta in attesa.</p>}
        {myPending.map(r => (
          <div key={r.id} className="bg-white p-5 rounded-3xl border-2 border-blue-100 shadow-sm flex items-center justify-between gap-4">
            <div><p className="font-black text-slate-800 uppercase text-sm">{r.userName}</p><p className="text-[10px] font-bold text-slate-400 uppercase">{r.type}: {r.dates?.length} giorni</p></div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => resolve(r.id, 'approvato')} className="p-4 bg-green-500 text-white rounded-2xl"><CheckCircle size={20}/></button>
              <button onClick={() => resolve(r.id, 'rifiutato')} className="p-4 bg-red-500 text-white rounded-2xl"><XCircle size={20}/></button>
            </div>
          </div>
        ))}
        <div className="bg-white rounded-3xl border p-5 space-y-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-3">Cronologia</p>
          {myHistory.length === 0 && <p className="text-slate-400 text-sm font-bold">Nessuna notifica.</p>}
          {myHistory.map(n => (
            <div key={n.id} className="flex gap-3 border-b border-slate-50 pb-3 last:border-0">
              <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0"></div>
              <div><p className="text-sm font-bold text-slate-700">{n.message}</p><p className="text-[9px] font-black text-slate-400 uppercase mt-0.5">{n.date}</p></div>
            </div>
          ))}
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

  const pendingCount = requests.filter(r => r.assignedTo === user.name && r.status === 'pendente').length;
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
      </nav>
    </div>
  );
}
