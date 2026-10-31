import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  FacebookAuthProvider,
  TwitterAuthProvider,
  GithubAuthProvider,
  OAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, enabledProviders } from "./firebase-config.js";
import {
  SOCIAL_PLATFORMS,
  socialUrl,
  normalizeEmail,
  isValidEmail,
  renderTree,
} from "./tree.js";

const $ = (id) => document.getElementById(id);

const PROVIDERS = {
  google: { label: "Continue with Google", make: () => new GoogleAuthProvider() },
  facebook: {
    label: "Continue with Facebook",
    make: () => {
      const p = new FacebookAuthProvider();
      p.addScope("email");
      return p;
    },
  },
  twitter: { label: "Continue with X (Twitter)", make: () => new TwitterAuthProvider() },
  github: {
    label: "Continue with GitHub",
    make: () => {
      const p = new GithubAuthProvider();
      p.addScope("user:email");
      return p;
    },
  },
  microsoft: { label: "Continue with Microsoft", make: () => new OAuthProvider("microsoft.com") },
};

const state = {
  user: null,
  email: "",
  treeId: null, // tree currently displayed
  trees: [], // [{ id, name, owned }]
  people: [], // people of the current tree
  unsubscribe: null,
  editingId: null,
  selected: null,
};

// ---------- UI helpers ----------
function showMessage(text, kind = "info") {
  const el = $("message");
  el.textContent = text;
  el.className = `banner ${kind}`;
  el.hidden = !text;
  if (text && kind !== "error") setTimeout(() => (el.hidden = true), 5000);
}

function friendlyAuthError(err) {
  switch (err && err.code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Please allow popups for this site.";
    case "auth/account-exists-with-different-credential":
      return "An account with this email already exists using a different sign-in provider. Please sign in with that provider.";
    case "auth/unauthorized-domain":
      return "This website's domain is not authorized in Firebase. Add it under Authentication → Settings → Authorized domains.";
    case "auth/operation-not-allowed":
      return "This sign-in provider is not enabled in Firebase yet.";
    default:
      return (err && err.message) || "Something went wrong.";
  }
}

function isOwnerView() {
  return state.user && state.treeId === state.user.uid;
}

// ---------- Boot ----------
const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_");
let auth, db;

buildProviderButtons();
buildSocialInputs();
wireDialogs();

if (!configured) {
  $("config-warning").hidden = false;
  $("landing").hidden = false;
  document.querySelectorAll("#provider-buttons button").forEach((b) => (b.disabled = true));
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, handleAuthChange);
}

function buildProviderButtons() {
  const wrap = $("provider-buttons");
  for (const key of enabledProviders) {
    const def = PROVIDERS[key];
    if (!def) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn btn-provider provider-${key}`;
    btn.textContent = def.label;
    btn.addEventListener("click", async () => {
      try {
        await signInWithPopup(auth, def.make());
      } catch (err) {
        const msg = friendlyAuthError(err);
        if (msg) showMessage(msg, "error");
      }
    });
    wrap.appendChild(btn);
  }
}

function buildSocialInputs() {
  const grid = $("social-inputs");
  for (const p of SOCIAL_PLATFORMS) {
    const label = document.createElement("label");
    label.textContent = p.label;
    const input = document.createElement("input");
    input.name = `social_${p.key}`;
    input.maxLength = 200;
    input.autocomplete = "off";
    input.placeholder = p.key === "linkedin" ? "username or profile URL" : "@username or profile URL";
    label.appendChild(input);
    grid.appendChild(label);
  }
}

function wireDialogs() {
  document.querySelectorAll("dialog [data-close]").forEach((b) =>
    b.addEventListener("click", () => b.closest("dialog").close())
  );
  $("sign-out").addEventListener("click", () => signOut(auth));
  $("add-person").addEventListener("click", () => openPersonDialog());
  $("person-form").addEventListener("submit", onSavePerson);
  $("details-edit").addEventListener("click", () => {
    const person = state.selected;
    $("details-dialog").close();
    openPersonDialog(person);
  });
  $("details-delete").addEventListener("click", onDeletePerson);
}

// ---------- Auth ----------
async function handleAuthChange(user) {
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = null;
  state.user = user;
  state.email = normalizeEmail(user && user.email);
  showMessage("");

  $("user-chip").hidden = !user;
  $("landing").hidden = !!user;
  $("app").hidden = !user;
  if (!user) {
    state.treeId = null;
    state.people = [];
    return;
  }

  $("user-name").textContent = user.displayName || user.email || "Signed in";
  const photo = $("user-photo");
  photo.hidden = !user.photoURL;
  if (user.photoURL) photo.src = user.photoURL;
  $("email-note").textContent = state.email
    ? `Relatives can add you with ${state.email} so you can see their tree.`
    : "Your social account didn't share an email, so trees others made for you can't be matched. Try another provider.";

  try {
    await ensureOwnTree(user);
    await loadTreeList();
    openTree(user.uid);
  } catch (err) {
    console.error(err);
    showMessage(`Could not load your data: ${err.message}`, "error");
  }
}

async function ensureOwnTree(user) {
  const treeRef = doc(db, "trees", user.uid);
  const snap = await getDoc(treeRef);
  if (snap.exists()) return;
  const batch = writeBatch(db);
  const selfRef = doc(collection(db, "trees", user.uid, "people"));
  batch.set(treeRef, {
    ownerUid: user.uid,
    ownerName: user.displayName || "My",
    memberEmails: state.email ? [state.email] : [],
    createdAt: Date.now(),
  });
  batch.set(selfRef, {
    name: user.displayName || "Me",
    email: state.email,
    socials: {},
    parentIds: [],
    spouseIds: [],
    isOwner: true,
    createdAt: Date.now(),
  });
  await batch.commit();
}

async function loadTreeList() {
  const trees = [{ id: state.user.uid, name: "My family tree", owned: true }];
  if (state.email) {
    const q = query(collection(db, "trees"), where("memberEmails", "array-contains", state.email));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      if (d.id === state.user.uid) return;
      const data = d.data();
      trees.push({ id: d.id, name: `${data.ownerName || "Someone"}'s family tree`, owned: false });
    });
  }
  state.trees = trees;
  renderTreeList();
}

function renderTreeList() {
  const nav = $("tree-list");
  nav.textContent = "";
  for (const t of state.trees) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tree-link" + (t.id === state.treeId ? " active" : "");
    btn.textContent = t.name;
    if (!t.owned) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "view only";
      btn.appendChild(tag);
    }
    btn.addEventListener("click", () => openTree(t.id));
    nav.appendChild(btn);
  }
  if (state.trees.length === 1) {
    const p = document.createElement("p");
    p.className = "muted small";
    p.textContent = "No one has added you to their tree yet.";
    nav.appendChild(p);
  }
}

// ---------- Tree ----------
function openTree(treeId) {
  if (state.unsubscribe) state.unsubscribe();
  state.treeId = treeId;
  state.people = [];
  const meta = state.trees.find((t) => t.id === treeId);
  $("tree-title").textContent = meta ? meta.name : "Family tree";
  $("tree-subtitle").textContent = isOwnerView()
    ? "Click a person to see details, edit or delete."
    : "You were added to this tree. It is read-only for you.";
  $("add-person").hidden = !isOwnerView();
  renderTreeList();
  $("tree").textContent = "Loading…";

  state.unsubscribe = onSnapshot(
    collection(db, "trees", treeId, "people"),
    (snap) => {
      state.people = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      draw();
    },
    (err) => {
      console.error(err);
      $("tree").textContent = "";
      showMessage(`Could not load this tree: ${err.message}`, "error");
    }
  );
}

function draw() {
  renderTree($("tree"), state.people, {
    highlightEmail: state.email,
    onSelect: showDetails,
  });
}

function personById(id) {
  return state.people.find((p) => p.id === id);
}

// ---------- Details ----------
function showDetails(person) {
  state.selected = person;
  $("details-name").textContent = person.name;
  const emailEl = $("details-email");
  emailEl.textContent = "";
  if (person.email) {
    const a = document.createElement("a");
    a.href = `mailto:${person.email}`;
    a.textContent = person.email;
    emailEl.appendChild(a);
  } else {
    emailEl.textContent = "No email";
  }

  const list = $("details-socials");
  list.textContent = "";
  for (const p of SOCIAL_PLATFORMS) {
    const value = person.socials && person.socials[p.key];
    const url = socialUrl(p.key, value);
    if (!url) continue;
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = `${p.label}: ${value}`;
    li.appendChild(a);
    list.appendChild(li);
  }

  const names = (ids) => (ids || []).map(personById).filter(Boolean).map((p) => p.name);
  const parents = names(person.parentIds);
  const spouses = names(person.spouseIds);
  const children = state.people.filter((p) => (p.parentIds || []).includes(person.id)).map((p) => p.name);
  const parts = [];
  if (parents.length) parts.push(`Parents: ${parents.join(", ")}`);
  if (spouses.length) parts.push(`Spouse: ${spouses.join(", ")}`);
  if (children.length) parts.push(`Children: ${children.join(", ")}`);
  $("details-relations").textContent = parts.join(" · ");

  const owner = isOwnerView();
  $("details-edit").hidden = !owner;
  $("details-delete").hidden = !owner || person.isOwner;
  $("details-dialog").showModal();
}

// ---------- Add / edit ----------
function openPersonDialog(person = null) {
  if (!isOwnerView()) {
    showMessage("Only the owner of this tree can add people.", "error");
    return;
  }
  state.editingId = person ? person.id : null;
  const form = $("person-form");
  form.reset();
  $("form-error").hidden = true;
  $("person-dialog-title").textContent = person ? "Edit family member" : "Add family member";
  $("relation-fields").hidden = !!person;

  if (person) {
    form.fullName.value = person.name || "";
    form.email.value = person.email || "";
    for (const p of SOCIAL_PLATFORMS) {
      form[`social_${p.key}`].value = (person.socials && person.socials[p.key]) || "";
    }
  } else {
    const select = $("relative-select");
    select.textContent = "";
    for (const p of state.people) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.isOwner ? `${p.name} (you)` : p.name;
      select.appendChild(opt);
    }
  }
  $("person-dialog").showModal();
  form.fullName.focus();
}

function formError(msg) {
  const el = $("form-error");
  el.textContent = msg;
  el.hidden = !msg;
}

function memberEmailsAfter(people) {
  return [...new Set(people.map((p) => normalizeEmail(p.email)).filter(Boolean))];
}

async function onSavePerson(event) {
  event.preventDefault();
  if (!isOwnerView()) return;
  const form = event.target;
  const name = form.fullName.value.trim();
  const email = normalizeEmail(form.email.value);
  if (!name) return formError("Please enter a name.");
  if (email && !isValidEmail(email)) return formError("Please enter a valid email.");

  const socials = {};
  for (const p of SOCIAL_PLATFORMS) {
    const v = form[`social_${p.key}`].value.trim();
    if (!v) continue;
    if (!socialUrl(p.key, v)) return formError(`${p.label}: enter a username or an http(s) link.`);
    socials[p.key] = v;
  }
  if (email && state.people.some((p) => p.email === email && p.id !== state.editingId)) {
    return formError("Someone in this tree already uses that email.");
  }

  const treeId = state.user.uid;
  const peopleCol = collection(db, "trees", treeId, "people");
  const batch = writeBatch(db);
  // Working copy so we can compute the final memberEmails list.
  const next = state.people.map((p) => ({ ...p, parentIds: [...(p.parentIds || [])], spouseIds: [...(p.spouseIds || [])] }));
  const touched = new Set();

  if (state.editingId) {
    const p = next.find((x) => x.id === state.editingId);
    Object.assign(p, { name, email, socials });
    touched.add(p.id);
  } else {
    const ref = doc(peopleCol);
    const person = { id: ref.id, name, email, socials, parentIds: [], spouseIds: [], isOwner: false, createdAt: Date.now() };
    const relation = form.relation.value;
    const relative = next.find((x) => x.id === form.relative.value);
    if (!relative) return formError("Choose who this person is related to.");

    if (relation === "child") {
      person.parentIds = [relative.id];
      const spouses = relative.spouseIds.filter((id) => next.some((x) => x.id === id));
      if (spouses.length === 1) person.parentIds.push(spouses[0]);
    } else if (relation === "parent") {
      if (relative.parentIds.length >= 2) return formError(`${relative.name} already has two parents.`);
      const existing = relative.parentIds[0];
      relative.parentIds.push(person.id);
      touched.add(relative.id);
      // The other parent becomes this person's partner so the tree draws as a couple.
      const other = existing && next.find((x) => x.id === existing);
      if (other) {
        person.spouseIds.push(other.id);
        other.spouseIds.push(person.id);
        touched.add(other.id);
      }
    } else if (relation === "spouse") {
      person.spouseIds.push(relative.id);
      relative.spouseIds.push(person.id);
      touched.add(relative.id);
    } else if (relation === "sibling") {
      if (!relative.parentIds.length) {
        return formError(`Add a parent for ${relative.name} first, then add siblings.`);
      }
      person.parentIds = [...relative.parentIds];
    }
    next.push(person);
    touched.add(person.id);
  }

  for (const id of touched) {
    const { id: _id, ...data } = next.find((x) => x.id === id);
    batch.set(doc(peopleCol, id), {
      name: data.name,
      email: data.email || "",
      socials: data.socials || {},
      parentIds: data.parentIds,
      spouseIds: data.spouseIds,
      isOwner: !!data.isOwner,
      createdAt: data.createdAt || Date.now(),
    });
  }
  batch.update(doc(db, "trees", treeId), {
    ownerUid: treeId,
    ownerName: state.user.displayName || "My",
    memberEmails: memberEmailsAfter(next),
  });

  const saveBtn = $("person-save");
  saveBtn.disabled = true;
  try {
    await batch.commit();
    $("person-dialog").close();
    showMessage(
      email
        ? `${name} saved. When they sign in with ${email}, they'll see this tree.`
        : `${name} saved.`,
      "success"
    );
  } catch (err) {
    console.error(err);
    formError(`Could not save: ${err.message}`);
  } finally {
    saveBtn.disabled = false;
  }
}

async function onDeletePerson() {
  const person = state.selected;
  if (!person || !isOwnerView() || person.isOwner) return;
  if (!confirm(`Remove ${person.name} from your tree?`)) return;

  const treeId = state.user.uid;
  const batch = writeBatch(db);
  const remaining = state.people.filter((p) => p.id !== person.id);
  for (const p of remaining) {
    const parentIds = (p.parentIds || []).filter((id) => id !== person.id);
    const spouseIds = (p.spouseIds || []).filter((id) => id !== person.id);
    if (parentIds.length !== (p.parentIds || []).length || spouseIds.length !== (p.spouseIds || []).length) {
      batch.update(doc(db, "trees", treeId, "people", p.id), { parentIds, spouseIds });
    }
  }
  batch.delete(doc(db, "trees", treeId, "people", person.id));
  batch.update(doc(db, "trees", treeId), { memberEmails: memberEmailsAfter(remaining) });
  try {
    await batch.commit();
    $("details-dialog").close();
    showMessage(`${person.name} removed.`, "success");
  } catch (err) {
    console.error(err);
    showMessage(`Could not delete: ${err.message}`, "error");
  }
}
