import { Component, useEffect, useRef, useState } from 'react';
import './index.css';
import { supabase, supabaseConfigured } from './supabase';
import { StaffOperations } from './StaffOperations';
import { DayEndReport } from './DayEndReport';
import {
  createPackages,
  getDriverIdByName,
  getCurrentDriverId,
  getCurrentPartnerId,
  getCurrentPartnerIdOptional,
  ensureAdminDriverWorkspace,
  setupAdminPartnerWorkspace,
  getPrivateFileUrl,
  loadApprovalAccounts,
  loadManagedUserAccounts,
  loadCurrentRole,
  loadFinanceRecords,
  loadDriverSettings,
  loadDriverRoster,
  loadWithdrawalRequests,
  loadNotifications,
  markNotificationRead,
  loadPackages,
  createBusinessExpense,
  reviewPayment,
  reviewWithdrawal,
  savePaymentAccount,
  loadPartnerLogo,
  savePartnerLogo,
  saveInvoiceCutoff,
  saveDriverSettings,
  adminUpdateDriverSettings,
  setAccountApproval,
  requestWithdrawal as requestDatabaseWithdrawal,
  submitInvoicePayment,
  sendPaymentReceipt,
  uploadIgoFile,
  updatePackage,
} from './igoDatabase';

const partnerOperatingLocation = 'Malé'; // Admin-configured partner operating location
const deliveryRates = {
  Malé: {
    Malé: 25,
    'Hulhumalé Phase 1': 35,
    'Hulhumalé Phase 2': 45,
    Boat: 25,
  },
  'Phase 1': {
    Malé: 35,
    'Hulhumalé Phase 1': 25,
    'Hulhumalé Phase 2': 30,
    Boat: 35,
  },
  'Phase 2': {
    Malé: 45,
    'Hulhumalé Phase 1': 30,
    'Hulhumalé Phase 2': 25,
    Boat: 45,
  },
};
const getDeliveryFee = (destination) =>
  deliveryRates[partnerOperatingLocation]?.[destination] ?? 35;

const initialPackages = [
  {
    id: 'IGO-1001',
    customer: 'Aminath Ahmed',
    phone: '7771234',
    area: 'Hulhumale',
    item: 'Clothing',
    fee: 35,
    status: 'Pending',
  },
  {
    id: 'IGO-1002',
    driver: 'Ahmed Rasheed',
    customer: 'Mohamed Ali',
    phone: '7775678',
    area: "Male'",
    item: 'Electronics',
    fee: 45,
    status: 'Out for Delivery',
  },
  {
    id: 'IGO-1003',
    customer: 'Fathimath Zaina',
    phone: '7779876',
    area: 'Villimale',
    item: 'Accessories',
    fee: 35,
    status: 'Delivered',
  },
];

const statusClass = (status) => status.toLowerCase().replaceAll(' ', '-');
const getStaffLandingPage = (profile) => {
  const roles = new Set((profile?.staffAssignments || []).map((assignment) => assignment.role));
  return ['department_requester', 'finance_approver', 'payment_officer'].some((role) => roles.has(role))
    ? 'Finance Management'
    : 'Staff Operations';
};
const shortWithdrawalRequestId = (id) => {
  const value = String(id || '');
  const compact = value.replace(/[^a-z0-9]/gi, '');
  return compact.length > 18
    ? 'WR-' + compact.slice(0, 10).toUpperCase()
    : value;
};
const shortExpenseRecordId = (id) => {
  const compact = String(id || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const suffix = compact.startsWith('EXP') ? compact.slice(-8) : compact.slice(0, 8);
  return 'EXP-' + (suffix || 'RECORD');
};
const compactExpenseReference = (value) => {
  const text = String(value || '');
  return text.length > 18 ? text.slice(0, 10) + '…' + text.slice(-4) : text;
};
const formatPackageAddedAt = (value) => {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};
const driverWithdrawalStorageKey = 'igo-driver-withdrawal-requests-v1';
const readDriverWithdrawalRequests = () => {
  try {
    const requests = JSON.parse(
      window.localStorage.getItem(driverWithdrawalStorageKey) || '[]'
    );
    return Array.isArray(requests) ? requests : [];
  } catch {
    return [];
  }
};
const saveDriverWithdrawalRequests = (requests) => {
  try {
    window.localStorage.setItem(
      driverWithdrawalStorageKey,
      JSON.stringify(requests)
    );
    window.dispatchEvent(new Event('igo-driver-withdrawals-updated'));
  } catch {}
};
const driverBankStorageKey = 'igo-driver-bank-details-v1';
const readDriverBankDetails = (driverName) => {
  try {
    const allDetails = JSON.parse(
      window.localStorage.getItem(driverBankStorageKey) || '{}'
    );
    return allDetails[driverName] || {};
  } catch {
    return {};
  }
};
const saveDriverBankDetails = (driverName, details) => {
  try {
    const allDetails = JSON.parse(
      window.localStorage.getItem(driverBankStorageKey) || '{}'
    );
    allDetails[driverName] = details;
    window.localStorage.setItem(driverBankStorageKey, JSON.stringify(allDetails));
    window.dispatchEvent(new Event('igo-driver-bank-updated'));
  } catch {}
};
const localDateKey = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};


const getPartnerDueFromStorage = () => {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem('igo-finance-workflow-demo-v1') || '{}'
    );
    return (saved.invoices || [])
      .filter((invoice) => invoice.partner === 'Style Hub')
      .reduce((sum, invoice) => {
        const paid = (saved.payments || [])
          .filter(
            (payment) =>
              payment.invoiceId === invoice.id && payment.status === 'confirmed'
          )
          .reduce((total, payment) => total + Number(payment.amount || 0), 0);
        return sum + Math.max(0, Number(invoice.amount || 0) - paid);
      }, 0);
  } catch {
    return 0;
  }
};
const getPartnerSpentFromStorage = (period = 'all') => {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem('igo-finance-workflow-demo-v1') || '{}'
    );
    const now = new Date();
    const start = new Date(now);
    if (period === 'week') start.setDate(start.getDate() - 7);
    if (period === 'month') start.setDate(1), start.setHours(0, 0, 0, 0);
    if (period === 'last3') start.setMonth(start.getMonth() - 3);
    if (period === 'year') start.setMonth(0, 1), start.setHours(0, 0, 0, 0);
    return (saved.payments || [])
      .filter((payment) => {
        if (
          payment.status !== 'confirmed' ||
          (payment.partner && payment.partner !== 'Style Hub')
        )
          return false;
        if (period === 'all') return true;
        const date = new Date(
          payment.verifiedAt ||
            payment.transferDate ||
            payment.submittedAt ||
            ''
        );
        return !Number.isNaN(date.getTime()) && date >= start && date <= now;
      })
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  } catch {
    return 0;
  }
};

function BrandIcon({ size = 42 }) {
  return (
    <svg
      width={size}
      height={size * 0.7}
      viewBox="0 0 100 70"
      role="img"
      aria-label="iGO route and destination logo"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="15" cy="12" r="9" fill="#0d0d0d" />
      <path
        d="M15 31v30"
        stroke="#0d0d0d"
        strokeWidth="16"
        strokeLinecap="round"
      />
      <path
        d="M29 48c9-16 20-16 29 0s20 16 29 0c-9-16-20-16-29 0s-20 16-29 0Z"
        fill="none"
        stroke="#0d0d0d"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M80 18c-9 0-16 7-16 16 0 12 16 29 16 29s16-17 16-29c0-9-7-16-16-16Z"
        fill="#e10600"
      />
      <circle cx="80" cy="34" r="5" fill="#0d0d0d" />
    </svg>
  );
}

// Compare delivery details, not IDs or calculated fees.
const normalizePackageText = (value = '') =>
  String(value).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const packageDuplicateKey = (entry) => {
  let phone = String(entry.phone || '').replace(/\D/g, '');
  if (phone.length === 10 && phone.startsWith('960')) phone = phone.slice(3);
  return JSON.stringify([
    normalizePackageText(entry.customer),
    phone,
    ...[
      'address',
      'area',
      'item',
      'notes',
      'boatLocation',
      'departureTime',
      'landmark',
    ].map((field) =>
      normalizePackageText(
        field === 'address' && entry.area === 'Boat'
          ? entry.boatName || entry.address
          : entry[field]
      )
    ),
  ]);
};

const normalizeCustomerPhone = (value = '') =>
  String(value)
    .trim()
    .replace(/^\+960[\s-]*/, '')
    .replace(/[\s-]/g, '');
const isValidCustomerPhone = (value) =>
  /^[79]\d{6}$/.test(normalizeCustomerPhone(value));

const normalizeDepartureTime = (value = '') => {
  const text = String(value).trim();
  if (!text) return '';
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return text;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23))
    return text;
  if (match[3]) hour = (hour % 12) + (match[3].toLowerCase() === 'pm' ? 12 : 0);
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
};
const validDepartureTime = (value) =>
  !value || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const deliveryDetails = (entry) =>
  entry.area === 'Boat'
    ? {
        address: (entry.boatName || '').trim(),
        boatName: (entry.boatName || '').trim(),
        boatLocation: (entry.boatLocation || '').trim(),
        departureTime: normalizeDepartureTime(entry.departureTime),
        landmark: '',
      }
    : {
        address: (entry.address || '').trim(),
        landmark: (entry.landmark || '').trim(),
        boatName: '',
        boatLocation: '',
        departureTime: '',
      };

async function loadSuperadminLinkedProfiles(user, profile) {
  if (profile?.role !== 'admin') return { isSuperadmin: false, partner: null, driver: null };
  const { data: isSuperadmin, error: roleError } = await supabase.rpc('is_igo_superadmin');
  if (roleError) throw roleError;
  if (isSuperadmin !== true) return { isSuperadmin: false, partner: null, driver: null };
  const [partnerResult, driverResult] = await Promise.all([
    supabase.from('partners').select('id,name,contact_name,phone,email,approval_status').eq('owner_id', user.id).maybeSingle(),
    supabase.from('drivers').select('id,name,phone,approval_status,active').eq('user_id', user.id).maybeSingle(),
  ]);
  if (partnerResult.error) throw partnerResult.error;
  if (driverResult.error) throw driverResult.error;
  return { isSuperadmin: true, partner: partnerResult.data, driver: driverResult.data };
}

class SectionErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Finance workspace render failed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="card" role="alert">
          <h2>Finance workspace could not load</h2>
          <p>Please refresh and try again.</p>
          <details>
            <summary>Technical details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {String(this.state.error?.message || this.state.error)}
            </pre>
          </details>
        </section>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const customerNameInputRef = useRef(null);
  const customerMessageInputRef = useRef(null);
  const [navigation, setNavigation] = useState({
    page: 'Overview',
    history: [],
  });
  const page = navigation.page;
  const [notificationScrollRequest, setNotificationScrollRequest] = useState(null);
  const [workspace, setWorkspace] = useState('Partner');
  const workspaceRef = useRef('Partner');
  const activeUserIdRef = useRef(null);
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);
  useEffect(() => {
    if (!notificationScrollRequest?.targetId) return undefined;
    let attempts = 0;
    let timer;
    const findAndScroll = () => {
      const target = document.getElementById(notificationScrollRequest.targetId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.add('notification-scroll-target');
        window.setTimeout(() => target.classList.remove('notification-scroll-target'), 1800);
        setNotificationScrollRequest(null);
      } else if (attempts++ < 15) {
        timer = window.setTimeout(findAndScroll, 100);
      } else {
        setNotificationScrollRequest(null);
      }
    };
    timer = window.setTimeout(findAndScroll, 80);
    return () => window.clearTimeout(timer);
  }, [notificationScrollRequest, page, workspace]);
  const [databaseUser, setDatabaseUser] = useState(null);
  const [databaseProfile, setDatabaseProfile] = useState(null);
  const availableWorkspaces = databaseProfile?.allowedWorkspaces || (databaseProfile?.role === 'admin' ? ['Admin', 'Partner', 'Driver'] : databaseProfile?.role === 'staff' ? ['Staff'] : []);
  const canShowWorkspaceSwitcher = databaseProfile?.role === 'admin'
    && databaseProfile?.workspaceSwitcherVisible !== false
    && availableWorkspaces.length > 1;
  const [accountApprovalStatus, setAccountApprovalStatus] = useState(null);
  const [databaseLoading, setDatabaseLoading] = useState(Boolean(supabaseConfigured));
  const [databaseError, setDatabaseError] = useState('');
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [linkedPartnerProfile, setLinkedPartnerProfile] = useState(null);
  const [linkedDriverProfile, setLinkedDriverProfile] = useState(null);
  const [partnerSetupOpen, setPartnerSetupOpen] = useState(false);
  const [partnerBusinessName, setPartnerBusinessName] = useState('');
  const [partnerBusinessAddress, setPartnerBusinessAddress] = useState('');
  const [partnerSetupBusy, setPartnerSetupBusy] = useState(false);
  const [partnerLogo, setPartnerLogo] = useState('');
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoFileSelected, setLogoFileSelected] = useState(false);
  const [logoFeedback, setLogoFeedback] = useState('');
  const [logoFeedbackKind, setLogoFeedbackKind] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [authMode, setAuthMode] = useState(() => {
    const recoveryParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return recoveryParams.get('type') === 'recovery' ? 'reset-password' : 'landing';
  });
  const [authNotice, setAuthNotice] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [invitePasswordSetupRequired, setInvitePasswordSetupRequired] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showGoToTop, setShowGoToTop] = useState(false);
  useEffect(() => {
    if (!showMobileNav && !showProfileMenu) return undefined;
    const closeOnOutsidePointer = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (showMobileNav && !target.closest('.mobile-nav-dropdown') && !target.closest('.mobile-nav-toggle')) {
        setShowMobileNav(false);
      }
      if (showProfileMenu && !target.closest('.profile-menu-container')) {
        setShowProfileMenu(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setShowMobileNav(false);
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showMobileNav, showProfileMenu]);
  useEffect(() => {
    const handleScroll = () => setShowGoToTop(window.scrollY > 120);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  const [pendingWithdrawalCount, setPendingWithdrawalCount] = useState(() =>
    readDriverWithdrawalRequests().filter((request) => request.status === 'pending').length
  );
  useEffect(() => {
    const sync = () =>
      setPendingWithdrawalCount(
        readDriverWithdrawalRequests().filter((request) => request.status === 'pending').length
      );
    window.addEventListener('igo-driver-withdrawals-updated', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('igo-driver-withdrawals-updated', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const [packages, setPackages] = useState(initialPackages);
  const [partnerAmountDue, setPartnerAmountDue] = useState(
    getPartnerDueFromStorage
  );
  const [partnerPendingPaymentCount, setPartnerPendingPaymentCount] = useState(0);
  const [partnerSpendPeriod, setPartnerSpendPeriod] = useState('all');
  const [partnerTotalSpent, setPartnerTotalSpent] = useState(() =>
    getPartnerSpentFromStorage('all')
  );
  const [invoicedPackageIds, setInvoicedPackageIds] = useState(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem('igo-finance-workflow-demo-v1') || '{}'
      );
      return [
        ...new Set(
          (saved.invoices || []).flatMap((invoice) =>
            (invoice.lines || []).map((line) => String(line.packageId))
          )
        ),
      ];
    } catch {
      return [];
    }
  });
  const [showEstimateList, setShowEstimateList] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState(null);
  useEffect(() => {
    if (databaseProfile) return undefined;
    const syncInvoicedPackages = () => {
      try {
        const saved = JSON.parse(
          window.localStorage.getItem('igo-finance-workflow-demo-v1') || '{}'
        );
        setInvoicedPackageIds([
          ...new Set(
            (saved.invoices || []).flatMap((invoice) =>
              (invoice.lines || []).map((line) => String(line.packageId))
            )
          ),
        ]);
        setPartnerAmountDue(getPartnerDueFromStorage());
        setPartnerTotalSpent(getPartnerSpentFromStorage(partnerSpendPeriod));
      } catch {
        setInvoicedPackageIds([]);
      }
    };
    window.addEventListener('igo-finance-updated', syncInvoicedPackages);
    return () =>
      window.removeEventListener('igo-finance-updated', syncInvoicedPackages);
  }, [partnerSpendPeriod, databaseProfile]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [partnerFilter, setPartnerFilter] = useState('All');
  const [driverFilter, setDriverFilter] = useState('All');
  const [areaFilter, setAreaFilter] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState('');
  const [bulkNotice, setBulkNotice] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [messageQueue, setMessageQueue] = useState([]);
  const [confirmBulkAdd, setConfirmBulkAdd] = useState(false);
  const [messageNotice, setMessageNotice] = useState('');
  const [form, setForm] = useState({
    customer: '',
    phone: '',
    address: '',
    boatName: '',
    boatLocation: '',
    departureTime: '',
    landmark: '',
    area: 'Malé',
    item: '',
    fee: String(getDeliveryFee('Malé')),
    notes: '',
  });

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    const activateSession = async (session) => {
      if (!session?.user) {
        setInvitePasswordSetupRequired(false);
        if (!active) return;
        activeUserIdRef.current = null;
        setDatabaseUser(null);
        setDatabaseProfile(null);
        setIsSuperadmin(false);
        setLinkedPartnerProfile(null);
        setLinkedDriverProfile(null);
        setPartnerLogo('');
        setPackages([]);
        setDatabaseLoading(false);
        return;
      }
      try {
        if (session.user.invited_at && session.user.user_metadata?.password_setup_complete !== true) { if (!active) return; setDatabaseUser(null); setDatabaseProfile(null); setIsSuperadmin(false); setLinkedPartnerProfile(null); setLinkedDriverProfile(null); setPartnerLogo(''); setPackages([]); setInvitePasswordSetupRequired(true); setAuthMode('invite-password-setup'); setDatabaseLoading(false); return; }
        const { user, profile: baseProfile } = await loadCurrentRole();
        const staffResult = await supabase.from('staff_role_assignments').select('id,department_id,role,active,departments(name)').eq('user_id', user.id).eq('active', true);
        if (staffResult.error) throw staffResult.error;
        const profile = baseProfile.role === 'staff' ? { ...baseProfile, staffAssignments: staffResult.data || [] } : baseProfile;
        const isStaff = profile.role === 'staff';
        const additionalProfiles = isStaff ? { isSuperadmin: false, partner: null, driver: null } : await loadSuperadminLinkedProfiles(user, profile);
        const canOperatePackages = (profile.staffAssignments || []).some((item) => ['operations_manager', 'operations_staff'].includes(item.role));
        const rows = isStaff ? (canOperatePackages ? await loadPackages() : []) : await loadPackages();
        let finance = null;
        if (profile.role === 'admin' || profile.role === 'partner') { try { const partnerId = profile.role === 'partner' ? await getCurrentPartnerIdOptional() : undefined; const financeWorkspace = profile.role === 'partner' ? 'Partner' : 'Admin'; finance = await loadFinanceRecords({ workspace: financeWorkspace, partnerId: partnerId || undefined }); } catch {} }
        if (!active) return;
        const roleWorkspace = { admin: 'Admin', partner: 'Partner', driver: 'Driver', staff: 'Staff' }[profile.role];
        if (!roleWorkspace) throw new Error('This account has no supported iGO role.');
        let approvalStatus = 'approved';
        if (profile.role === 'partner') {
          const { data: approvalRecord, error: approvalError } = await supabase.from('partners').select('approval_status,logo_data_url').eq('owner_id', user.id).maybeSingle();
          if (approvalError) throw approvalError;
          approvalStatus = approvalRecord?.approval_status || 'pending';
          setPartnerLogo(approvalRecord?.logo_data_url || '');
        } else if (profile.role === 'driver') {
          const { data: approvalRecord, error: approvalError } = await supabase.from('drivers').select('approval_status').eq('user_id', user.id).maybeSingle();
          if (approvalError) throw approvalError;
          approvalStatus = approvalRecord?.approval_status || 'pending';
        }
        setAccountApprovalStatus(approvalStatus);
        if (!roleWorkspace) throw new Error('This account has no supported iGO role.');
        setDatabaseUser(user);
        setDatabaseProfile(profile);
        setIsSuperadmin(additionalProfiles.isSuperadmin);
        setLinkedPartnerProfile(additionalProfiles.partner);
        setLinkedDriverProfile(additionalProfiles.driver);
        const selectedWorkspace = workspaceRef.current;
        const keepSelectedWorkspace = activeUserIdRef.current === user.id && (
          selectedWorkspace === roleWorkspace
          || (additionalProfiles.isSuperadmin && selectedWorkspace === 'Partner' && additionalProfiles.partner?.approval_status === 'approved')
          || (additionalProfiles.isSuperadmin && selectedWorkspace === 'Driver' && additionalProfiles.driver?.approval_status === 'approved')
        );
        const nextWorkspace = keepSelectedWorkspace ? selectedWorkspace : roleWorkspace;
        activeUserIdRef.current = user.id;
        workspaceRef.current = nextWorkspace;
        setWorkspace(nextWorkspace);
        setPackages(rows);
        if (finance) applyDatabaseFinanceSnapshot(finance);
        if (!keepSelectedWorkspace) setNavigation({ page: nextWorkspace === 'Admin' ? 'Admin Operations' : nextWorkspace === 'Driver' ? 'Driver Overview' : nextWorkspace === 'Staff' ? getStaffLandingPage(profile) : 'Overview', history: [] });
        setDatabaseError('');
      } catch (error) {
        if (!active) return;
        setDatabaseUser(session.user);
        setDatabaseProfile(null);
        setIsSuperadmin(false);
        setLinkedPartnerProfile(null);
        setLinkedDriverProfile(null);
        setPartnerLogo('');
        setPackages([]);
        setDatabaseError(error.message || 'Could not load this iGO account.');
      } finally {
        if (active) setDatabaseLoading(false);
      }
    };
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setDatabaseError(error.message);
      void activateSession(data?.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setAuthMode('reset-password');
        setDatabaseLoading(false);
        return;
      }
      // Initial session and token refreshes do not change the signed-in account.
      // Re-running activateSession for those events would reset a superadmin's
      // selected linked workspace back to the account's default Admin workspace.
      if (!['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED', 'USER_DELETED'].includes(event)) return;
      void activateSession(session);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const isDriverWorkspace =
      databaseProfile?.role === 'driver'
      || (isSuperadmin && workspace === 'Driver' && linkedDriverProfile?.approval_status === 'approved');
    if (!isDriverWorkspace || !databaseUser?.id) return undefined;
    let active = true;
    const heartbeat = async () => {
      try {
        const settings = await loadDriverSettings();
        if (!active || !settings.online) return;
        await saveDriverSettings({
          online: true,
          online_updated_at: new Date().toISOString(),
        });
      } catch {
        // A missed heartbeat naturally expires the driver's online status.
      }
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [databaseProfile?.role, databaseUser?.id, isSuperadmin, workspace, linkedDriverProfile?.approval_status]);

  const savePartnerLogoFromProfile = async (event) => {
    event.preventDefault();
    setNotice('');
    const formElement = event.currentTarget;
    const file = formElement.elements.partner_logo.files?.[0];
    if (!file) {
      setLogoFeedbackKind('error');
      setLogoFeedback('Choose a logo image before saving.');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 256 * 1024) {
      setLogoFeedbackKind('error');
      setLogoFeedback('Choose a PNG, JPEG, or WebP image up to 256 KB.');
      return;
    }
    setLogoSaving(true);
    setLogoFeedback('');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const logoDataUrl = String(reader.result || '');
        await savePartnerLogo(logoDataUrl);
        setPartnerLogo(logoDataUrl);
        setLogoFeedbackKind('success');
        setLogoFeedback('Logo saved. Drivers will see it on your job tiles.');
        formElement.reset();
        setLogoFileSelected(false);
      } catch (error) {
        setLogoFeedbackKind('error');
        setLogoFeedback(error.message || 'Could not save the logo. Please try again.');
      } finally {
        setLogoSaving(false);
      }
    };
    reader.onerror = () => {
      setLogoFeedbackKind('error');
      setLogoFeedback('Could not read that image. Please choose it again.');
      setLogoSaving(false);
    };
    reader.readAsDataURL(file);
  };

  const signInToDatabase = async (event) => {
    event.preventDefault();
    if (!supabase) return;
    setLoginBusy(true);
    setDatabaseError('');
    const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail.trim(), password: loginPassword });
    if (error) {
      setDatabaseError(error.message);
      setLoginBusy(false);
      return;
    }
    setLoginPassword('');
    if (data.user?.invited_at && data.user.user_metadata?.password_setup_complete !== true) { setInvitePasswordSetupRequired(true); setAuthMode('invite-password-setup'); setLoginBusy(false); return; }
    if (data.session) {
      try {
        const { profile: baseProfile } = await loadCurrentRole();
        const staffResult = await supabase.from('staff_role_assignments').select('id,department_id,role,active,departments(name)').eq('user_id', data.user.id).eq('active', true);
        if (staffResult.error) throw staffResult.error;
        const profile = baseProfile.role === 'staff' ? { ...baseProfile, staffAssignments: staffResult.data || [] } : baseProfile;
        const isStaff = profile.role === 'staff';
        const additionalProfiles = isStaff ? { isSuperadmin: false, partner: null, driver: null } : await loadSuperadminLinkedProfiles(data.user, profile);
        const canOperatePackages = (profile.staffAssignments || []).some((item) => ['operations_manager', 'operations_staff'].includes(item.role));
        const rows = isStaff ? (canOperatePackages ? await loadPackages() : []) : await loadPackages();
        let finance = null;
        if (profile.role === 'admin' || profile.role === 'partner') { try { const partnerId = profile.role === 'partner' ? await getCurrentPartnerIdOptional() : undefined; const financeWorkspace = profile.role === 'partner' ? 'Partner' : 'Admin'; finance = await loadFinanceRecords({ workspace: financeWorkspace, partnerId: partnerId || undefined }); } catch {} }
        const roleWorkspace = { admin: 'Admin', partner: 'Partner', driver: 'Driver', staff: 'Staff' }[profile.role];
        if (!roleWorkspace) throw new Error('This account has no supported iGO role.');
        setDatabaseUser(data.user);
        setDatabaseProfile(profile);
        setIsSuperadmin(additionalProfiles.isSuperadmin);
        setLinkedPartnerProfile(additionalProfiles.partner);
        setLinkedDriverProfile(additionalProfiles.driver);
        setPackages(rows);
        if (finance) applyDatabaseFinanceSnapshot(finance);
        setWorkspace(roleWorkspace);
        setNavigation({ page: roleWorkspace === 'Admin' ? 'Admin Operations' : roleWorkspace === 'Driver' ? 'Driver Overview' : roleWorkspace === 'Staff' ? getStaffLandingPage(profile) : 'Overview', history: [] });
      } catch (loadError) {
        await supabase.auth.signOut();
        setDatabaseError(loadError.message || 'This account is not linked to an iGO profile.');
      }
    }
    setLoginBusy(false);
  };

  const switchWorkspace = async (next) => {
    if (databaseProfile?.role === 'admin' && !availableWorkspaces.includes(next)) {
      setNotice('This account does not have access to that workspace.');
      return;
    }
    setNotice('');
    setDatabaseError('');
    setShowForm(false);
    setShowMobileNav(false);
    setStatusFilter('All');
    setSearch('');
    if (databaseProfile?.role === 'admin' && next === 'Partner') {
      try {
        const partnerId = await getCurrentPartnerIdOptional();
        setWorkspace('Partner');
        setNavigation({ page: 'Overview', history: [] });
        if (!partnerId) {
          setPackages([]);
          setPartnerBusinessName('');
          setPartnerBusinessAddress('');
          setPartnerSetupOpen(true);
        } else {
          const { data: partner, error } = await supabase.from('partners').select('id,name,contact_name,phone,email,approval_status').eq('id', partnerId).single();
          if (error) throw error;
          setLinkedPartnerProfile(partner);
          setPackages(await loadPackages({ partnerId }));
          applyDatabaseFinanceSnapshot(await loadFinanceRecords({ workspace: 'Partner', partnerId }));
        }
      } catch (error) { setNotice(error.message || 'Could not open the partner workspace.'); }
      return;
    }
    if (databaseProfile?.role === 'admin' && next === 'Driver') {
      try {
        const driverId = await ensureAdminDriverWorkspace();
        const { data: driver, error } = await supabase.from('drivers').select('id,name,phone,approval_status,active').eq('id', driverId).single();
        if (error) throw error;
        setLinkedDriverProfile(driver);
        setPackages(await loadPackages({ driverId }));
      } catch (error) { setNotice(error.message || 'Could not open the driver workspace.'); return; }
    }
    if (databaseProfile?.role === 'admin' && next === 'Admin') {
      try {
        setPackages(await loadPackages());
        applyDatabaseFinanceSnapshot(await loadFinanceRecords({ workspace: 'Admin' }));
      } catch (error) { setNotice(error.message || 'Could not load admin operations.'); }
    }
    setWorkspace(next);
    setNavigation({ page: next === 'Admin' ? 'Admin Operations' : next === 'Driver' ? 'Driver Overview' : 'Overview', history: [] });
  };

  const saveAdminPartnerSetup = async (event) => {
    event.preventDefault();
    if (!partnerBusinessName.trim() || !partnerBusinessAddress.trim()) return;
    setPartnerSetupBusy(true);
    setNotice('');
    try {
      const partnerId = await setupAdminPartnerWorkspace({ businessName: partnerBusinessName, address: partnerBusinessAddress });
      const { data: partner, error } = await supabase.from('partners').select('id,name,contact_name,phone,email,approval_status').eq('id', partnerId).single();
      if (error) throw error;
      setLinkedPartnerProfile(partner);
      setPackages(await loadPackages({ partnerId }));
      applyDatabaseFinanceSnapshot(await loadFinanceRecords({ workspace: 'Partner', partnerId }));
      setPartnerSetupOpen(false);
      setNotice('Partner workspace is ready.');
    } catch (error) { setNotice(error.message || 'Could not save partner details.'); }
    finally { setPartnerSetupBusy(false); }
  };

  const completeInvitedPasswordSetup = async (event) => {
    event.preventDefault();
    if (!supabase) return;
    if (newPassword !== confirmNewPassword) { setDatabaseError('The passwords do not match.'); return; }
    setLoginBusy(true); setDatabaseError('');
    const { data: currentUserData, error: currentUserError } = await supabase.auth.getUser();
    if (currentUserError || !currentUserData.user) { setDatabaseError(currentUserError?.message || 'Your invitation session expired. Open the invitation link again.'); setLoginBusy(false); return; }
    const { data, error } = await supabase.auth.updateUser({ password: newPassword, data: { ...(currentUserData.user.user_metadata || {}), password_setup_complete: true } });
    if (error) { setDatabaseError(error.message); setLoginBusy(false); return; }
    if (data.user?.user_metadata?.password_setup_complete !== true) { setDatabaseError('Password saved, but account setup could not be confirmed. Please sign in again.'); setLoginBusy(false); return; }
    window.location.reload();
  };

  const registerPublicAccount = async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const values = new FormData(event.currentTarget);
    const role = authMode === 'register-driver' ? 'driver' : 'partner';
    const fullName = String(values.get('full_name') || '').trim();
    const phone = String(values.get('phone') || '').trim();
    const email = String(values.get('email') || '').trim();
    const password = String(values.get('password') || '');
    const logoFile = role === 'partner' ? values.get('logo') : null;
    let logoDataUrl = '';
    if (logoFile?.size) {
      const allowedLogoTypes = ['image/png', 'image/jpeg', 'image/webp'];
      if (!allowedLogoTypes.includes(logoFile.type) || logoFile.size > 256 * 1024) {
        setDatabaseError('Choose a PNG, JPEG, or WebP logo no larger than 256 KB.');
        return;
      }
      try {
        logoDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('The logo could not be read.'));
          reader.readAsDataURL(logoFile);
        });
      } catch (logoError) {
        setDatabaseError(logoError.message || 'The logo could not be read.');
        return;
      }
    }
    setLoginBusy(true);
    setDatabaseError('');
    setAuthNotice('');
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            igo_self_registration: true,
            role,
            full_name: fullName,
            phone,
            business_name: String(values.get('business_name') || '').trim(),
            address: String(values.get('address') || '').trim(),
            logo_data_url: logoDataUrl || null,
          },
        },
      });
      if (error) {
        setDatabaseError(error.message);
      } else {
        setLoginEmail(email);
        setLoginPassword('');
        setAuthMode('signin');
        setAuthNotice('Your request has been submitted. Check your email to confirm the address. ' + (role === 'partner' ? 'A partner account needs admin approval before you can use the workspace.' : 'A rider account needs admin approval before you can use the workspace.'));
      }
    } catch (registrationError) {
      setDatabaseError(registrationError.message || 'Your application could not be submitted. Please try again.');
    } finally {
      setLoginBusy(false);
    }
  };

  const requestPasswordReset = async (event) => {
    event.preventDefault();
    if (!supabase || !loginEmail.trim()) return;
    setLoginBusy(true);
    setDatabaseError('');
    setAuthNotice('');
    const { error } = await supabase.auth.resetPasswordForEmail(loginEmail.trim(), {
      redirectTo: window.location.origin,
    });
    if (error) setDatabaseError(error.message);
    else setAuthNotice('If an account uses that email, a password reset link is on its way.');
    setLoginBusy(false);
  };

  const saveRecoveredPassword = async (event) => {
    event.preventDefault();
    if (!supabase) return;
    setLoginBusy(true);
    setDatabaseError('');
    setAuthNotice('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setDatabaseError(error.message);
    else {
      setNewPassword('');
      setAuthNotice('Your password has been updated.');
      setAuthMode('signin');
    }
    setLoginBusy(false);
  };

  const signOutFromDatabase = async () => {
    if (supabase) await supabase.auth.signOut();
    setDatabaseUser(null);
    setDatabaseProfile(null);
    setIsSuperadmin(false);
    setLinkedPartnerProfile(null);
    setLinkedDriverProfile(null);
    setPackages(supabaseConfigured ? [] : initialPackages);
    setPartnerPendingPaymentCount(0);
    setDatabaseError('');
    setAuthNotice('');
    setAuthMode('landing');
  };

  const applyDatabaseFinanceSnapshot = (records) => {
    const packageIds = records.invoices.flatMap((invoice) => invoice.lines.map((line) => String(line.packageId)));
    setInvoicedPackageIds([...new Set(packageIds)]);
    setPartnerAmountDue(records.invoices.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.amount || 0) - Number(invoice.paidAmount || 0)), 0));
    setPartnerPendingPaymentCount((records.payments || []).filter((payment) => payment.status === 'pending_verification').length);
    const now = new Date();
    const start = new Date(now);
    if (partnerSpendPeriod === 'week') start.setDate(start.getDate() - 7);
    if (partnerSpendPeriod === 'month') start.setDate(1), start.setHours(0, 0, 0, 0);
    if (partnerSpendPeriod === 'last3') start.setMonth(start.getMonth() - 3);
    if (partnerSpendPeriod === 'year') start.setMonth(0, 1), start.setHours(0, 0, 0, 0);
    setPartnerTotalSpent(records.payments.filter((payment) => payment.status === 'confirmed').filter((payment) => {
      if (partnerSpendPeriod === 'all') return true;
      const paidAt = new Date(payment.verifiedAt || payment.transferDate || payment.submittedAt || '');
      return !Number.isNaN(paidAt.getTime()) && paidAt >= start && paidAt <= now;
    }).reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  };

  useEffect(() => {
    if (!supabase || !databaseUser) return undefined;
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (!active || refreshing || document.visibilityState !== 'visible') return;
      refreshing = true;
      try {
        const partnerId = workspace === 'Partner' && ['admin', 'partner'].includes(databaseProfile?.role) ? await getCurrentPartnerIdOptional() : undefined;
        const driverId = databaseProfile?.role === 'admin' && workspace === 'Driver' ? await getCurrentDriverId() : null;
        const rows = databaseProfile?.role === 'admin' && workspace === 'Partner' && !partnerId ? [] : await loadPackages({ partnerId: partnerId || undefined, driverId: driverId || undefined });
        if (active) setPackages(rows);
        try {
          if (workspace === 'Admin' || workspace === 'Partner') { const finance = await loadFinanceRecords({ workspace, partnerId: partnerId || undefined });
          if (active) {
            applyDatabaseFinanceSnapshot(finance);
            window.dispatchEvent(new Event('igo-live-data-refreshed'));
          }
        } } catch {}
      } catch (error) {
        if (active) setDatabaseError(error.message || 'Could not refresh iGO records.');
      } finally { refreshing = false; }
    };
    const refreshOnResume = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('igo-live-finance-updated', refresh);
    window.addEventListener('focus', refreshOnResume);
    document.addEventListener('visibilitychange', refreshOnResume);
    const interval = window.setInterval(refresh, 15000);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('igo-live-finance-updated', refresh);
      window.removeEventListener('focus', refreshOnResume);
      document.removeEventListener('visibilitychange', refreshOnResume);
    };
  }, [databaseUser, databaseProfile, workspace, partnerSpendPeriod]);

  const updatePackageRecord = async (id, rawChanges) => {
    const current = packages.find((item) => item.id === id);
    if (supabaseConfigured) {
      if (!current?.dbId) {
        setNotice('This package is not connected to a saved database record.');
        return;
      }
      try {
        const changes = { ...rawChanges };
        if (Object.hasOwn(changes, 'driver')) {
          changes.assignedDriverId = !changes.driver?.trim()
            ? null
            : workspace === 'Driver'
              ? await getCurrentDriverId()
              : await getDriverIdByName(changes.driver);
          delete changes.driver;
        }
        if (changes.proofPhoto) {
          const imageFile = await (async () => {
            const response = await fetch(changes.proofPhoto);
            const blob = await response.blob();
            return new File([blob], `pod-${current.id}.jpg`, { type: blob.type || 'image/jpeg' });
          })();
          changes.proofOfDeliveryPath = await uploadIgoFile(imageFile, 'proof', current.dbId);
          delete changes.proofPhoto;
        }
        if (changes.handoverPhoto) {
          const response = await fetch(changes.handoverPhoto);
          const blob = await response.blob();
          const imageFile = new File([blob], `pod-${current.id}.jpg`, { type: blob.type || 'image/jpeg' });
          changes.proofOfDeliveryPath = await uploadIgoFile(imageFile, 'proof', current.dbId);
          delete changes.handoverPhoto;
        }
        if (changes.status === 'Picked Up' || changes.status === 'Out for Delivery') {
          changes.pickedUpAt ||= new Date().toISOString();
        }
        if (changes.status === 'Delivered') changes.deliveredAt ||= new Date().toISOString();
        if (changes.failureReason) {
          changes.failedAttemptReason = changes.failureReason;
          delete changes.failureReason;
        }
        delete changes.returnedToGodown;
        delete changes.driverReturnConfirmed;
        const saved = await updatePackage(current.dbId, changes);
        setPackages((list) => list.map((item) => item.dbId === saved.dbId ? saved : item));
        setNotice('Package saved.');
      } catch (error) {
        setNotice(error.message || 'Could not update this package.');
      }
      return;
    }
    setPackages((list) => list.map((item) => item.id === id ? { ...item, ...rawChanges } : item));
    setNotice('Demo status updated in this preview.');
  };

  function handleNotificationNavigate(item) {
    const explicitPage = [item.target_page, item.related_page, item.page, item.destination]
      .find((value) => typeof value === 'string' && value.trim());
    const explicitTarget = [
      item.target_element_id,
      item.target_anchor,
      item.anchor_id,
      item.related_section,
      item.target_section,
    ].find((value) => typeof value === 'string' && value.trim());
    const pages = ['Admin Operations', 'User Management', 'Approvals', 'Packages', 'Register Package', 'Finance Management', 'Invoices & Payments', 'Overview', 'Profile', 'About', 'Driver Overview', 'My Deliveries', 'Staff Operations'];
    let destination = pages.find((page) => page.toLowerCase() === String(explicitPage || '').trim().toLowerCase());
    const notificationText = [item.type, item.category, item.entity_type, item.related_type, item.title, item.message]
      .filter(Boolean).join(' ');
    const details = notificationText.toLowerCase();
    const title = String(item.title || '').toLowerCase();
    let packageReference = item.package_number || item.tracking_number || item.tracking_code || item.package_code || item.package_id ||
      (/(package|delivery)/.test(String(item.entity_type || item.related_type || '').toLowerCase()) ? item.related_id || item.entity_id : '');
    if (!packageReference) {
      const match = notificationText.match(/\bpackage\s+(?:igo[-\s]?)?(\d+)\b/i);
      if (match) packageReference = 'IGO-' + match[1];
    }

    let targetId = explicitTarget;
    let targetWorkspace = '';
    if (/new user awaiting approval/.test(title)) {
      destination = destination || 'Approvals';
      targetId = targetId || 'pending-account-approvals';
      targetWorkspace = 'Admin';
    } else if (/new delivery available/.test(title)) {
      destination = destination || 'Driver Overview';
      targetId = targetId || 'driver-new-jobs';
      targetWorkspace = 'Driver';
    } else if (/withdrawal request updated/.test(title)) {
      destination = destination || 'Driver Overview';
      targetId = targetId || 'driver-earnings';
      targetWorkspace = 'Driver';
    } else if (/driver withdrawal request/.test(title)) {
      destination = destination || 'Finance Management';
      targetId = targetId || 'admin-withdrawal-requests';
      targetWorkspace = 'Admin';
    } else if (/partner payment submitted/.test(title)) {
      destination = destination || 'Finance Management';
      targetId = targetId || 'admin-payment-review';
      targetWorkspace = 'Admin';
    } else if (/invoice available|payment approved|payment needs attention/.test(title)) {
      destination = destination || 'Invoices & Payments';
      targetId = targetId || 'partner-invoice-payment-options';
      targetWorkspace = 'Partner';
    } else if (/package status updated/.test(title)) {
      destination = destination || 'Packages';
      targetId = targetId || 'package-list';
      targetWorkspace = 'Partner';
    }

    if (!destination && packageReference) {
      destination = workspace === 'Driver' ? 'Driver Overview' : 'Packages';
      targetId = targetId || (workspace === 'Driver' ? 'driver-new-jobs' : 'package-list');
    }
    if (!destination && /(approval|application|pending account|partner request|rider request)/.test(details)) {
      destination = workspace === 'Admin' ? 'Approvals' : 'Profile';
      targetId = targetId || (workspace === 'Admin' ? 'pending-account-approvals' : 'profile-details');
      if (workspace === 'Admin') targetWorkspace = 'Admin';
    } else if (!destination && workspace === 'Staff' && /(payment|withdrawal|expense|financial|finance)/.test(details)) {
      destination = 'Staff Operations'; targetId = targetId || 'staff-payment-status'; targetWorkspace = 'Staff';
    } else if (!destination && /(invoice|payment|withdrawal|expense|financial|finance|billing)/.test(details)) {
      destination = workspace === 'Admin' ? 'Finance Management' : 'Invoices & Payments';
      targetId = targetId || (workspace === 'Admin' ? 'admin-payment-review' : 'partner-invoice-payment-options');
      if (workspace === 'Admin') targetWorkspace = 'Admin';
      else if (workspace === 'Driver') {
        destination = 'Driver Overview';
        targetId = 'driver-earnings';
        targetWorkspace = 'Driver';
      } else targetWorkspace = 'Partner';
    } else if (!destination && /(package|delivery|tracking|shipment|pickup)/.test(details)) {
      destination = workspace === 'Driver' ? 'Driver Overview' : 'Packages';
      targetId = targetId || (workspace === 'Driver' ? 'driver-new-jobs' : 'package-list');
    } else if (!destination && /(profile|account|user)/.test(details)) {
      destination = workspace === 'Admin' ? 'User Management' : 'Profile';
      targetId = targetId || (workspace === 'Admin' ? 'user-management' : 'profile-details');
      if (workspace === 'Admin') targetWorkspace = 'Admin';
    }

    if (!destination && workspace === 'Staff' && /(payment|withdrawal|expense|finance|approval)/.test(details)) { destination = 'Staff Operations'; targetId = targetId || 'staff-payment-status'; targetWorkspace = 'Staff'; }
    destination = destination || (workspace === 'Admin' ? 'Admin Operations' : workspace === 'Driver' ? 'Driver Overview' : workspace === 'Staff' ? 'Staff Operations' : 'Overview');
    if (!targetId) {
      targetId = destination === 'Packages' ? 'package-list'
        : destination === 'Driver Overview' || destination === 'My Deliveries' ? 'driver-new-jobs'
        : destination === 'Approvals' ? 'pending-account-approvals'
        : destination === 'User Management' ? 'user-management'
        : destination === 'Profile' ? 'profile-details'
        : destination === 'Finance Management' ? 'admin-payment-review'
        : destination === 'Invoices & Payments' ? (workspace === 'Driver' ? 'driver-earnings' : 'partner-invoice-payment-options')
        : '';
    }
    if (!targetWorkspace) {
      if (['Admin Operations', 'User Management', 'Approvals', 'Finance Management'].includes(destination)) targetWorkspace = 'Admin';
      else if (destination === 'Driver Overview' || destination === 'My Deliveries' || destination === 'About') targetWorkspace = 'Driver';
      else if (destination === 'Invoices & Payments' || destination === 'Register Package') targetWorkspace = 'Partner';
      else if (destination === 'Staff Operations') targetWorkspace = 'Staff';
    }

    const navigate = async () => {
      if (databaseProfile?.role === 'admin' && targetWorkspace && workspace !== targetWorkspace) {
        await switchWorkspace(targetWorkspace);
      }
      if (destination === 'Packages' && packageReference) setSearch(String(packageReference));
      setPage(destination);
      if (targetId) setNotificationScrollRequest({ targetId, requestId: Date.now() + Math.random() });
    };
    void navigate();
  }

  function setPage(nextPage) {
    setNavigation((current) =>
      current.page === nextPage
        ? current
        : {
            page: nextPage,
            history: [
              ...current.history,
              { page: current.page, search, statusFilter },
            ],
          }
    );
  }

  function goBack() {
    const previous = navigation.history[navigation.history.length - 1];
    if (!previous) return;
    setNavigation({
      page: previous.page,
      history: navigation.history.slice(0, -1),
    });
    setSearch(previous.search);
    setStatusFilter(previous.statusFilter);
    setShowForm(previous.page === 'Register Package');
    setShowMobileNav(false);
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const updateForm = (e) => {
    const { name, value } = e.target;
    setForm((current) => ({
      ...current,
      [name]: name === 'phone' ? normalizeCustomerPhone(value) : value,
      ...(name === 'area' ? { fee: String(getDeliveryFee(value)) } : {}),
    }));
  };

  async function registerPackage(e) {
    e.preventDefault();

    if (!isValidCustomerPhone(form.phone)) {
      setNotice('Customer phone must contain 7 digits and start with 7 or 9.');
      return;
    }
    const deliveryAddress = (
      form.area === 'Boat' ? form.boatName : form.address
    ).trim();
    if (!deliveryAddress) {
      setNotice(
        form.area === 'Boat'
          ? 'Please enter the boat name.'
          : 'Please enter the delivery address.'
      );
      return;
    }
    const nextPackage = {
      ...form,
      address: deliveryAddress,
      boatName: form.area === 'Boat' ? form.boatName.trim() : '',
      boatLocation: form.area === 'Boat' ? form.boatLocation.trim() : '',
      departureTime: form.area === 'Boat' ? form.departureTime : '',
      landmark: form.area === 'Boat' ? '' : form.landmark.trim(),
      phone: normalizeCustomerPhone(form.phone),
      id: `IGO-${1001 + packages.length}`,
      fee: Number(form.fee),
      status: 'Pending',
    };

    if (supabaseConfigured) {
      if (!databaseUser || databaseProfile?.role !== 'partner' && !(databaseProfile?.role === 'admin' && workspace === 'Partner' && linkedPartnerProfile?.approval_status === 'approved')) {
        setNotice('Sign in to an approved partner account before registering packages.');
        return;
      }
      try {
        const partnerId = await getCurrentPartnerId();
        const [created] = await createPackages([nextPackage], partnerId);
        setPackages((current) => [created, ...current]);
      } catch (error) {
        setNotice(error.message || 'Could not save the package.');
        return;
      }
    } else {
      setPackages((current) => [nextPackage, ...current]);
    }

    const addMore = window.confirm(
      'Package added successfully!\n\n' +
        'Do you want to add another package?\n\n' +
        'OK = Add another package\n' +
        'Cancel = Go to package list'
    );

    if (addMore) {
      setForm({
        customer: '',
        phone: '',
        address: '',
        boatName: '',
        boatLocation: '',
        departureTime: '',
        landmark: '',
        area: 'Malé',
        item: '',
        fee: String(getDeliveryFee('Malé')),
        notes: '',
      });

      setMessageDraft('');
      setMessageNotice('');
      setNotice('');
      setShowForm(true);
      setPage('Register Package');
      window.requestAnimationFrame(() => customerNameInputRef.current?.focus());
    } else {
      setShowForm(false);
      setPage('Packages');
    }
  }

  function parseCsv(text) {
    const rows = [];
    let row = [],
      cell = '',
      quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') {
        row.push(cell.trim());
        cell = '';
      } else if (char === '\n') {
        row.push(cell.trim());
        if (row.some((value) => value)) rows.push(row);
        row = [];
        cell = '';
      } else if (char !== '\r') cell += char;
    }
    row.push(cell.trim());
    if (row.some((value) => value)) rows.push(row);
    return rows;
  }

  function downloadBulkTemplate() {
    const headers = [
      'Customer name',
      'Phone number',
      'Destination',
      'Delivery address',
      'Nearby landmark',
      'Boat name',
      'Boat location',
      'Departure time',
      'Delivery instructions',
      'Package description',
    ];
    const blob = new Blob([headers.join(',') + '\r\n'], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'igo-bulk-packages-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleBulkUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBulkNotice('');
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2)
        throw new Error('Include a header row and at least one package row.');
      const headers = rows[0].map((value) =>
        value
          .replace(/^\uFEFF/, '')
          .trim()
          .toLowerCase()
      );
      const column = (name) => headers.indexOf(name.toLowerCase());
      if (
        ['Customer name', 'Phone number', 'Destination'].some(
          (name) => column(name) < 0
        )
      )
        throw new Error(
          'Required columns: Customer name, Phone number, and Destination.'
        );
      if (
        column('Delivery address / boat name') < 0 &&
        column('Delivery address') < 0 &&
        column('Boat name') < 0
      )
        throw new Error('Include Delivery address and/or Boat name columns.');
      const validRows = [];
      let skipped = 0;
      for (const cells of rows.slice(1)) {
        if (!cells.some((value) => value.trim())) continue;
        const cell = (name) => (cells[column(name)] || '').trim();
        const area = cell('Destination');
        const entry = {
          customer: cell('Customer name'),
          phone: normalizeCustomerPhone(cell('Phone number')),
          area,
          address:
            cell('Delivery address') || cell('Delivery address / boat name'),
          boatName:
            cell('Boat name') ||
            (area === 'Boat' ? cell('Delivery address / boat name') : ''),
          boatLocation: cell('Boat location'),
          departureTime: normalizeDepartureTime(cell('Departure time')),
          landmark: cell('Nearby landmark'),
          notes: cell('Delivery instructions'),
          item: cell('Package description'),
        };
        Object.assign(entry, deliveryDetails(entry));
        if (
          !entry.customer ||
          !isValidCustomerPhone(entry.phone) ||
          !entry.address ||
          !['Malé', 'Hulhumalé Phase 1', 'Hulhumalé Phase 2', 'Boat'].includes(
            area
          ) ||
          !validDepartureTime(entry.departureTime)
        ) {
          skipped += 1;
          continue;
        }
        validRows.push(entry);
      }
      if (!validRows.length)
        throw new Error(
          'No valid rows. Boat needs a boat name; other destinations need an address. Check phone numbers and departure times.'
        );
      const added = validRows.map((entry, index) => ({
          ...entry,
          id: 'IGO-' + (1001 + packages.length + index),
          fee: getDeliveryFee(entry.area),
          status: 'Pending',
        }));
      if (supabaseConfigured) {
        if (databaseProfile?.role !== 'partner' && !(databaseProfile?.role === 'admin' && workspace === 'Partner' && linkedPartnerProfile?.approval_status === 'approved')) throw new Error('Sign in to an approved partner account to add packages.');
        const partnerId = await getCurrentPartnerId();
        const saved = await createPackages(added, partnerId);
        setPackages((current) => [...saved, ...current]);
      } else setPackages((current) => [...added, ...current]);
      setBulkNotice(
        validRows.length +
          ' package(s) added.' +
          (skipped
            ? ' ' +
              skipped +
              ' row(s) skipped: check required name, phone, destination, address or boat name, and departure time.'
            : '')
      );
    } catch (error) {
      setBulkNotice(error.message || 'Could not read that CSV.');
    } finally {
      event.target.value = '';
    }
  }

  function readMessageField(text, labelPattern) {
    const match = text.match(
      new RegExp(
        '(?:^|\\n)\\s*(?:' + labelPattern + ')\\s*[:=-]\\s*(.+)$',
        'im'
      )
    );
    return match ? match[1].trim() : '';
  }

  function fillFromMessage() {
    const text = messageDraft.trim();
    if (!text) {
      setMessageNotice(
        'Please paste a customer message before filling the package details.'
      );
      return;
    }
    const updates = {};
    const cleanLines = text
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^[>•\-\s]+/, ''))
      .filter(Boolean);
    const phoneLineIndex = cleanLines.findIndex((line) =>
      /(?:\+?960[\s-]?)?[79]\d{6}/.test(line)
    );
    const unlabelledLines = cleanLines.filter(
      (line) =>
        !/^(?:name|customer|customer\s*name|phone|address|delivery\s*address|deliver\s*to|boat\s*name|vessel\s*name|boat\s*location|departure\s*time|departure|nearby\s*landmark|landmark|location|harbour|jetty|destination|island|area|package|item|order|instructions|delivery\s*instructions|notes)\s*[:=-]/i.test(
          line
        ) && !/(?:\+?960[\s-]?)?[79]\d{6}/.test(line)
    );
    const customer = readMessageField(text, 'customer\\s*name|name|customer');
    const labeledPhone = readMessageField(
      text,
      'phone|phone\\s*number|mobile|contact'
    );
    const phoneMatch = text.match(/(?<![\d+])(?:\+960[ -]*)?[79]\d{6}(?!\d)/);
    const phone = labeledPhone || phoneMatch?.[0] || '';
    const address = readMessageField(
      text,
      'delivery\\s*address|address|deliver\\s*to'
    );
    const item = readMessageField(text, 'package|item|order');
    const notes = readMessageField(
      text,
      'delivery\\s*instructions|instructions|notes'
    );
    if (customer) updates.customer = customer;
    if (!customer && unlabelledLines.length) {
      const inferredName = unlabelledLines[0]
        .replace(/^(?:hi|hello|assalamu alaikum)[,!. ]+/i, '')
        .trim();
      if (inferredName) updates.customer = inferredName;
    }
    if (!address) {
      const afterPhone =
        phoneLineIndex >= 0
          ? cleanLines
              .slice(phoneLineIndex + 1)
              .find(
                (line) =>
                  /[a-z]/i.test(line) &&
                  !/^(?:boat\s*name|vessel\s*name|boat\s*location|departure\s*time|departure|nearby\s*landmark|landmark|location|harbour|jetty|destination|island|area|package|item|order|instructions|notes)\s*[:=-]/i.test(
                    line
                  )
              )
          : '';
      const inferredAddress =
        afterPhone ||
        (unlabelledLines.length > 1
          ? unlabelledLines[unlabelledLines.length - 1]
          : '');
      if (inferredAddress && inferredAddress !== updates.customer)
        updates.address = inferredAddress;
    }
    if (phone) updates.phone = normalizeCustomerPhone(phone);
    if (address) updates.address = address;
    if (item) updates.item = item;
    if (notes) updates.notes = notes;
    const locationText = [
      readMessageField(text, 'destination|island|area'),
      address,
      text,
    ]
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const hasHulhumale = /\bhulhu?\s*male\b/.test(locationText);
    const isPhase2 =
      /\bphase[\s-]*(?:2|ii|two)\b|\bp2\b/.test(locationText) ||
      (hasHulhumale && /\b(?:lot|plot)\s*20\d{3}\b/.test(locationText));
    const isPhase1 =
      /\bphase[\s-]*(?:1|i|one)\b|\bp1\b/.test(locationText) ||
      (hasHulhumale && /\b(?:lot|plot)\s*1\d{4}\b/.test(locationText));
    if (isPhase2) updates.area = 'Hulhumalé Phase 2';
    else if (isPhase1) updates.area = 'Hulhumalé Phase 1';
    else if (/\bboat\b|\b(?:dhoani|launch)\b/.test(locationText))
      updates.area = 'Boat';
    else if (
      /\bmale\b|\bmaafannu\b|\bhenveiru\b|\bgalolhu\b|\bmachchangolhi\b|\bvillimale\b|\bvillingili\b/.test(
        locationText
      )
    )
      updates.area = 'Malé';
    if (!Object.keys(updates).length) {
      setMessageNotice(
        'No customer details recognized. Use labels such as Name:, Phone:, Address:, and Destination:.'
      );
      return;
    }
    const boatName = readMessageField(text, 'boat\\s*name|vessel\\s*name');
    const explicitArea = readMessageField(text, 'destination|island|area');
    const destinations = [
      'Malé',
      'Hulhumalé Phase 1',
      'Hulhumalé Phase 2',
      'Boat',
    ];
    const matchedArea = destinations.find(
      (area) =>
        normalizePackageText(area) === normalizePackageText(explicitArea)
    );
    const draftArea =
      matchedArea || (boatName ? 'Boat' : updates.area) || form.area || 'Malé';
    const draft = {
      customer: updates.customer || '',
      phone: updates.phone || '',
      address: updates.address || '',
      area: draftArea,
      item: updates.item || '',
      notes: updates.notes || '',
      boatName: draftArea === 'Boat' ? boatName || address || '' : '',
      boatLocation: readMessageField(
        text,
        'boat\\s*location|harbour|jetty|location'
      ),
      departureTime: normalizeDepartureTime(
        readMessageField(text, 'departure\\s*time|departure')
      ),
      landmark: readMessageField(text, 'nearby\\s*landmark|landmark'),
      fee: String(getDeliveryFee(draftArea)),
    };
    Object.assign(draft, deliveryDetails(draft));
    const duplicateKey = packageDuplicateKey(draft);
    if (
      messageQueue.some((entry) => packageDuplicateKey(entry) === duplicateKey)
    ) {
      setMessageNotice(
        'This package is already in the review list. It was not added again.'
      );
      return;
    }
    if (packages.some((entry) => packageDuplicateKey(entry) === duplicateKey)) {
      setMessageNotice(
        'This package is already registered. It was not added again.'
      );
      return;
    }
    setMessageQueue((current) => [
      ...current,
      { ...draft, queueId: Date.now() + Math.random() },
    ]);
    setConfirmBulkAdd(false);
    setMessageDraft('');
    const labels = {
      customer: 'name',
      phone: 'phone',
      address: 'address',
      area: 'destination',
      item: 'description',
      notes: 'instructions',
    };
    setMessageNotice(
      'Added to review list: ' +
        Object.keys(updates)
          .map((key) => labels[key])
          .join(', ') +
        '. Check the list before adding packages.'
    );
    window.requestAnimationFrame(() => customerMessageInputRef.current?.focus());
  }

  function updateQueuedPackage(queueId, field, value) {
    setMessageQueue((current) =>
      current.map((entry) =>
        entry.queueId === queueId
          ? {
              ...entry,
              [field]:
                field === 'phone' ? normalizeCustomerPhone(value) : value,
              ...(field === 'area'
                ? { fee: String(getDeliveryFee(value)) }
                : {}),
            }
          : entry
      )
    );
  }

  async function confirmAddQueuedPackages() {
    const incomplete = messageQueue.filter(
      (entry) =>
        !entry.customer.trim() ||
        !isValidCustomerPhone(entry.phone) ||
        !(entry.area === 'Boat' ? entry.boatName : entry.address)?.trim() ||
        !validDepartureTime(
          entry.area === 'Boat'
            ? normalizeDepartureTime(entry.departureTime)
            : ''
        )
    );
    if (incomplete.length) {
      setMessageNotice(
        'Each package needs a customer name, valid 7-digit phone starting with 7 or 9, and a boat name for Boat or an address for other destinations. Check any departure time.'
      );
      setConfirmBulkAdd(false);
      return;
    }
    if (!messageQueue.length) return;
    const seen = new Set(packages.map(packageDuplicateKey));
    const duplicateRows = [];
    messageQueue.forEach((entry, index) => {
      const key = packageDuplicateKey(entry);
      if (seen.has(key)) duplicateRows.push(index + 1);
      seen.add(key);
    });
    if (duplicateRows.length) {
      setMessageNotice(
        'Duplicate package(s) at review row(s) ' +
          duplicateRows.join(', ') +
          '. Remove the duplicate rows or correct their details before confirming. No packages were added.'
      );
      setConfirmBulkAdd(false);
      return;
    }
    const count = messageQueue.length;
    const added = messageQueue.map((entry, index) => ({
        ...entry,
        ...deliveryDetails(entry),
        phone: normalizeCustomerPhone(entry.phone),
        id: 'IGO-' + (1001 + packages.length + index),
        fee: getDeliveryFee(entry.area),
        status: 'Pending',
      }));
    if (supabaseConfigured) {
      if (databaseProfile?.role !== 'partner' && !(databaseProfile?.role === 'admin' && workspace === 'Partner' && linkedPartnerProfile?.approval_status === 'approved')) {
        setMessageNotice('Sign in to an approved partner account to add packages.');
        return;
      }
      try {
        const partnerId = await getCurrentPartnerId();
        const saved = await createPackages(added, partnerId);
        setPackages((current) => [...saved, ...current]);
      } catch (error) {
        setMessageNotice(error.message || 'Could not save these packages.');
        return;
      }
    } else setPackages((current) => [...added, ...current]);
    setMessageQueue([]);
    setConfirmBulkAdd(false);
    setMessageNotice('Added ' + count + ' packages to your package list.');
  }

  // Package IDs increase in every registration and import flow.
  const newestPackages = [...packages].sort(
    (a, b) => Number(b.id.slice(4)) - Number(a.id.slice(4))
  );
  const openPackageSummary = (status = 'All') => {
    setSearch('');
    setStatusFilter(status);
    setPartnerFilter('All');
    setDriverFilter('All');
    setAreaFilter('All');
    setShowForm(false);
    setShowMobileNav(false);
    setPage('Packages');
    window.setTimeout(() => {
      document.getElementById('dispatch-queue-heading')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 700);
  };
  const filtered = newestPackages.filter((p) => {
    const partnerKey = String(p.partnerId || p.partnerName || p.partner || 'Unknown partner');
    const driverName = p.driver || '';
    const searchable = `${p.id} ${p.customer} ${p.phone} ${p.area} ${p.address} ${p.status} ${p.partnerName || p.partner || ''} ${driverName}`;
    return (
      (statusFilter === 'All' ||
        (statusFilter === 'Active'
          ? !['Delivered', 'Cancelled'].includes(p.status)
          : p.status === statusFilter)) &&
      (partnerFilter === 'All' || partnerKey === partnerFilter) &&
      (driverFilter === 'All' ||
        (driverFilter === '__unassigned__' ? !driverName : driverName === driverFilter)) &&
      (areaFilter === 'All' || p.area === areaFilter) &&
      searchable.toLowerCase().includes(search.trim().toLowerCase())
    );
  });

  const total = packages.length;
  const delivered = packages.filter((p) => p.status === 'Delivered').length;
  const pending = packages.filter((p) => p.status === 'Pending').length;
  const estimatedPackages = packages.filter(
    (p) =>
      p.status !== 'Cancelled' && !invoicedPackageIds.includes(String(p.id))
  );
  const outstanding = estimatedPackages.reduce(
    (sum, p) => sum + Number(p.fee || 0),
    0
  );

  const staffRoles = new Set((databaseProfile?.staffAssignments || []).map((item) => item.role));
  const hasFinanceAccess = ['department_requester', 'finance_approver', 'payment_officer', 'operations_manager'].some((role) => staffRoles.has(role));
  const hasStaffOperationsAccess = ['operations_manager', 'operations_staff', 'customer_support', 'people_manager'].some((role) => staffRoles.has(role));
  const navItems =
    workspace === 'Staff'
      ? [
          ...(hasStaffOperationsAccess ? [['Staff Operations', '▣']] : []),
          ...(hasFinanceAccess ? [['Finance Management', '♙']] : []),
        ]
      : workspace === 'Driver'
      ? [
          ['Driver Overview', '⌂'],
          ['My Deliveries', '▤'],
          ['About', '♙'],
        ]
      : workspace === 'Admin'
      ? [
          ['Admin Operations', '⌂'],
          ['Packages', '▤'],
          ['Invoices & Payments', '▣'],
          ['Finance Management', '♙'],
          ['Approvals', '✓', 'Pending user approvals'],
          ['User Management', '♙'],
        ]
      : [
          ['Overview', '⌂'],
          ['Register Package', '+'],
          ['Packages', '▤'],
          ['Invoices & Payments', '▣'],
        ];

  if (supabaseConfigured && databaseProfile && accountApprovalStatus && accountApprovalStatus !== 'approved') {
    const isPending = accountApprovalStatus === 'pending';
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: '#f4f6f7' }}>
        <section className="card" style={{ width: 'min(100%, 520px)', padding: 32, textAlign: 'center' }}>
          <p className="eyebrow">iGO DELIVERY</p>
          <h1>{isPending ? 'Account awaiting approval' : 'Account access is unavailable'}</h1>
          <p>{isPending ? 'Your account is set up. An admin must approve it before you can access the partner or driver workspace.' : 'Your account is not approved for the iGO workspace. Contact an admin for help.'}</p>
          <p className="muted">Status: {accountApprovalStatus}</p>
          <p>To use a different account, sign out here, then log in with the other account’s email and password.</p>
          <button
            type="button"
            className="primary-btn"
            style={{ marginTop: 8 }}
            onClick={() => { void signOutFromDatabase(); }}
          >Sign out and switch account</button>
        </section>
      </main>
    );
  }

  const activeLinkedProfile = databaseProfile?.role === 'admin' ? (workspace === 'Partner' ? linkedPartnerProfile : workspace === 'Driver' ? linkedDriverProfile : null) : null;
  const viewedProfileName = activeLinkedProfile?.name || databaseProfile?.full_name || (workspace === 'Admin' ? 'Operations' : workspace === 'Driver' ? 'Ahmed Rasheed' : 'Style Hub');
  const viewedProfileType = activeLinkedProfile ? workspace.toLowerCase() : databaseProfile?.role || workspace + ' preview';

  if (supabaseConfigured && authMode === 'reset-password') {
    return <main className="public-auth-page"><section className="public-auth-card"><p className="approval-kicker">iGO DELIVERY · ACCOUNT ACCESS</p><h1>Choose a new password</h1><p>Use at least 8 characters for your new password.</p>{databaseError && <p className="notice" role="alert">{databaseError}</p>}{authNotice && <p className="notice" role="status">{authNotice}</p>}<form onSubmit={saveRecoveredPassword}><label>New password<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><button className="primary-btn" type="submit" disabled={loginBusy}>{loginBusy ? 'Saving…' : 'Save new password'}</button></form></section></main>;
  }

  if (supabaseConfigured && (databaseLoading || !databaseProfile)) {
    if (databaseLoading) {
      return <main className="public-loading"><section className="public-auth-card"><p className="approval-kicker">iGO DELIVERY</p><h1>Connecting to iGO</h1><p>Loading your account…</p></section></main>;
    }

    if (authMode === 'landing') {
      return (
        <div className="public-site" data-theme={localStorage.getItem('igo-theme') === 'night' ? 'night' : 'day'}>
          <header className="public-header">
            <a className="public-brand" href="#home" aria-label="iGO Delivery home"><img src="/igo-logo.jpg" alt="iGO Delivery" /><span>iGO Delivery</span></a>
            <nav aria-label="Main navigation"><button className="theme-toggle" type="button" aria-label="Switch to night mode" title="Switch to night mode" aria-pressed="false" onClick={(event) => { const site = event.currentTarget.closest('.public-site'); const night = site.dataset.theme !== 'night'; site.dataset.theme = night ? 'night' : 'day'; localStorage.setItem('igo-theme', night ? 'night' : 'day'); event.currentTarget.setAttribute('aria-pressed', String(night)); event.currentTarget.setAttribute('aria-label', night ? 'Switch to day mode' : 'Switch to night mode'); event.currentTarget.setAttribute('title', night ? 'Switch to day mode' : 'Switch to night mode'); event.currentTarget.textContent = night ? '☀' : '☾'; }}>{localStorage.getItem('igo-theme') === 'night' ? '☀' : '☾'}</button><button className="secondary-btn" type="button" onClick={() => { setDatabaseError(''); setAuthNotice(''); setAuthMode('register-partner'); }}>Register as a partner</button><button className="primary-btn" type="button" onClick={() => { setDatabaseError(''); setAuthNotice(''); setAuthMode('signin'); }}>Log in</button></nav>
          </header>
          <main id="home">
            <section className="public-hero">
              <div className="public-hero-copy"><p className="approval-kicker">DELIVERY THAT MOVES BUSINESS FORWARD</p><h1>Focus on your business. We’ll handle the deliveries.</h1><p>Best rates. Fast delivery.</p><button className="primary-btn" type="button" onClick={() => { setDatabaseError(''); setAuthNotice(''); setAuthMode('register-partner'); }}>Become a partner <span aria-hidden="true">→</span></button><small>Partner applications are reviewed before account access is enabled.</small></div>
              <div className="public-hero-art" aria-hidden="true"><div className="public-route-card"><div className="public-route-heading"><img className="public-route-pin-logo" src="/igo-logo.jpg" alt="iGO" /></div><ol className="public-journey"><li className="journey-order"><span>01</span><strong>Package registered</strong></li><li className="journey-pickup"><span>02</span><strong>Picked up</strong></li><li className="journey-delivered"><span>03</span><strong>Delivered</strong></li></ol></div></div>
            </section>
            <section className="public-how" id="how-it-works"><p className="approval-kicker">WHY CHOOSE US!</p><h2>Why choose iGO?</h2><p className="public-section-intro">Great rates, fast delivery, and easy package tracking.</p><div className="public-feature-grid"><article><span>01</span><h3>Best rates</h3><p>Keep delivery costs low as your business grows.</p></article><article><span>02</span><h3>Fast delivery</h3><p>We pick up and deliver your packages promptly.</p></article><article><span>03</span><h3>Easy tracking</h3><p>Check each package’s status whenever you need.</p></article></div><div className="public-delivery-coverage"><h3>Where we deliver</h3><p>Malé · Hulhumalé Phase 1 · Hulhumalé Phase 2 · Boat deliveries</p></div></section>
            <section className="public-rider"><div><p className="approval-kicker">FOR RIDERS</p><h2>Interested in delivering with iGO?</h2><p>Join the rider network. Rider applications are reviewed by the iGO team.</p></div><button className="secondary-btn" type="button" onClick={() => { setDatabaseError(''); setAuthNotice(''); setAuthMode('register-driver'); }}>Become a rider</button></section>
          </main>
          <footer className="public-footer"><span>© {new Date().getFullYear()} iGO Delivery</span><button type="button" onClick={() => setAuthMode('signin')}>Account sign in</button></footer>
        </div>
      );
    }

    if (authMode === 'register-partner' || authMode === 'register-driver') {
      const isPartnerRegistration = authMode === 'register-partner';
      return (
        <main className="public-auth-page" data-theme={localStorage.getItem('igo-theme') === 'night' ? 'night' : 'day'}><button className="auth-theme-toggle" type="button" aria-label="Switch theme" title="Switch theme" onClick={(event) => { const page = event.currentTarget.closest('.public-auth-page'); const night = page.dataset.theme !== 'night'; page.dataset.theme = night ? 'night' : 'day'; localStorage.setItem('igo-theme', night ? 'night' : 'day'); event.currentTarget.textContent = night ? '☀' : '☾'; }}>{localStorage.getItem('igo-theme') === 'night' ? '☀' : '☾'}</button><button className="public-back-link" type="button" onClick={() => { setDatabaseError(''); setAuthMode('landing'); }}>← Back to iGO</button><form className="public-auth-card" onSubmit={registerPublicAccount}><h1>{isPartnerRegistration ? 'Register as a partner' : 'Become an iGO rider'}</h1><p>{isPartnerRegistration ? 'Apply to join iGO as a delivery partner.' : 'Apply to deliver with iGO.'}</p>{databaseError && <p className="notice" role="alert">{databaseError}</p>}<label>Full name *<input name="full_name" autoComplete="name" required /></label><label>Email *<input name="email" type="email" autoComplete="email" required /></label><label>Registered phone number *<input name="phone" type="tel" autoComplete="tel" required /></label>{isPartnerRegistration && <><label>Business name *<input name="business_name" autoComplete="organization" required /></label><label>Business address *<input name="address" autoComplete="street-address" required /></label><label>Partner logo (optional)<input name="logo" type="file" accept="image/png,image/jpeg,image/webp" /><small>Upload a PNG, JPEG, or WebP image, up to 256 KB.</small></label></>}<label>Create password *<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label><p className="public-form-note">Every account must have a registered phone number. Partner and rider accounts need admin approval.</p><button className="primary-btn" type="submit" disabled={loginBusy}>{loginBusy ? 'Sending application…' : 'Submit application'}</button><p className="public-auth-switch">Already have an account? <button type="button" onClick={() => { setDatabaseError(''); setAuthMode('signin'); }}>Log in</button></p></form></main>
      );
    }

if (authMode === 'invite-password-setup' || invitePasswordSetupRequired) { return <main className="public-auth-page"><section className="public-auth-card"><p className="approval-kicker">iGO DELIVERY · ACCOUNT ACCESS</p><h1>Set up your password</h1><p>Your account is ready. Choose a password to enter your workspace.</p>{databaseError && <p className="notice" role="alert">{databaseError}</p>}<form onSubmit={completeInvitedPasswordSetup}><label>New password<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label>Confirm password<input type="password" autoComplete="new-password" minLength={8} required value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} /></label><button className="primary-btn" type="submit" disabled={loginBusy}>{loginBusy ? 'Setting up…' : 'Set password and continue'}</button></form></section></main>; }

  if (authMode === 'forgot-password') {
      return <main className="public-auth-page"><section className="public-auth-card"><button className="public-back-link" type="button" onClick={() => { setDatabaseError(''); setAuthNotice(''); setAuthMode('signin'); }}>← Back to sign in</button><p className="approval-kicker">iGO DELIVERY · ACCOUNT ACCESS</p><h1>Reset your password</h1><p>Enter the email address on your iGO account and we’ll send a reset link.</p>{databaseError && <p className="notice" role="alert">{databaseError}</p>}{authNotice && <p className="notice" role="status">{authNotice}</p>}<form onSubmit={requestPasswordReset}><label>Email<input type="email" autoComplete="email" required value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} /></label><button className="primary-btn" type="submit" disabled={loginBusy}>{loginBusy ? 'Sending link…' : 'Send reset link'}</button></form></section></main>;
    }

    return (
      <main className="public-auth-page" data-theme={localStorage.getItem('igo-theme') === 'night' ? 'night' : 'day'}><button className="auth-theme-toggle" type="button" aria-label="Switch theme" title="Switch theme" onClick={(event) => { const page = event.currentTarget.closest('.public-auth-page'); const night = page.dataset.theme !== 'night'; page.dataset.theme = night ? 'night' : 'day'; localStorage.setItem('igo-theme', night ? 'night' : 'day'); event.currentTarget.textContent = night ? '☀' : '☾'; }}>{localStorage.getItem('igo-theme') === 'night' ? '☀' : '☾'}</button><button className="public-back-link" type="button" onClick={() => { setDatabaseError(''); setAuthNotice(''); setAuthMode('landing'); }}>← Back to iGO</button><form className="public-auth-card" onSubmit={signInToDatabase}><p className="approval-kicker">iGO DELIVERY · ACCOUNT ACCESS</p><h1>Sign in</h1><p>Use your approved partner, rider, or admin account.</p>{authNotice && <p className="notice" role="status">{authNotice}</p>}{databaseError && <p className="notice" role="alert">{databaseError}</p>}<label>Email<input type="email" autoComplete="username" required value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} /></label><button className="public-forgot-link" type="button" onClick={() => { setDatabaseError(''); setAuthNotice(''); setAuthMode('forgot-password'); }}>Forgot password?</button><button className="primary-btn" type="submit" disabled={loginBusy}>{loginBusy ? 'Signing in…' : 'Sign in'}</button><p className="public-auth-switch">Need a partner account? <button type="button" onClick={() => { setDatabaseError(''); setAuthNotice(''); setAuthMode('register-partner'); }}>Register as a partner</button></p></form></main>
    );
  }

  return (
    <div className="app" data-theme={localStorage.getItem('igo-theme') === 'night' ? 'night' : 'day'}>
      <aside className="sidebar">
        <div className="brand">
          <div>
            <h2>iGO Delivery</h2>
            <span>
              {workspace === 'Admin' ? 'ADMIN WORKSPACE' : workspace === 'Driver' ? (activeLinkedProfile ? 'DRIVER PROFILE' : 'DRIVER DEMO') : activeLinkedProfile ? 'PARTNER PROFILE' : 'PARTNER PORTAL'}
            </span>
          </div>
        </div>

        <div className="partner-profile">
          <div className="partner-avatar">
            {viewedProfileName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'OP'}
          </div>
          <div>
            <strong>{viewedProfileName}</strong>
            <p>
              {activeLinkedProfile ? workspace + ' profile' : workspace === 'Admin' ? (databaseProfile ? '' : 'Operations account · Demo') : databaseProfile ? '' : 'Partner account · Demo'}
            </p>
          </div>
        </div>

        <p className="nav-label">MY WORKSPACE</p>

        {navItems.map(([name, icon, label = name]) => (
          <button
            key={name}
            className={`nav-item ${page === name ? 'selected' : ''}`}
            onClick={() => {
              setPage(name);
              if (name === 'Packages') {
                setStatusFilter('All');
                setSearch('');
              }
              setNotice('');
              if (name === 'Register Package') setShowForm(true);
              else setShowForm(false);
            }}
          >
            <span>{icon}</span>
            {label}
            {workspace === 'Admin' && name === 'Finance Management' && pendingWithdrawalCount > 0 && (
              <span className="withdrawal-alert-badge" aria-label={pendingWithdrawalCount + ' pending driver withdrawals'}>
                {pendingWithdrawalCount}
              </span>
            )}
          </button>
        ))}

        <div className="sidebar-bottom">
          <div className="status-dot" />
          <div>
            <strong>{viewedProfileName}</strong>
            <p>{activeLinkedProfile ? workspace + ' profile' : workspace + ' workspace'}</p>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="dashboard-logo"
            aria-label="iGO Delivery dashboard"
            onClick={() => {
              setPage(workspace === 'Admin' ? 'Admin Operations' : workspace === 'Staff' ? 'Staff Operations' : 'Overview');
              setShowForm(false);
              setShowMobileNav(false);
              setNotice('');
            }}
          >
            <img
              src="/igo-logo.jpg"
              alt="iGO Delivery"
              width="46"
              height="36"
              style={{ display: 'block', objectFit: 'contain' }}
            />
          </button>
          <button
            type="button"
            className="mobile-nav-toggle"
            aria-expanded={showMobileNav}
            aria-controls="mobile-primary-navigation"
            onClick={() => setShowMobileNav((open) => !open)}
          >
            ☰ Menu
          </button>

          {showMobileNav && (
            <div className="mobile-nav-dropdown" id="mobile-primary-navigation">
              {navItems.map(([name, icon, displayLabel = name]) => (
                <button
                  key={name}
                  onClick={() => {
                    setPage(name);
                    if (name === 'Packages') {
                      setStatusFilter('All');
                      setSearch('');
                    }
                    setNotice('');
                    setShowForm(name === 'Register Package');
                    setShowMobileNav(false);
                  }}
                >
                  {icon} {displayLabel}
                </button>
              ))}
            </div>
          )}
          {databaseProfile ? (
            canShowWorkspaceSwitcher ? (
              <label className="workspace-switch">
                <span>View workspace</span>
                <select
                  aria-label="View workspace"
                  value={workspace}
                  onChange={(event) => void switchWorkspace(event.target.value)}
                >
                  {availableWorkspaces.map((name) => <option key={name} value={name}>{name === 'Admin' ? 'Admin workspace' : name + ' workspace'}</option>)}
                </select>
              </label>
            ) : (
              <div className="workspace-switch"><span></span><strong>{workspace} · {databaseProfile.full_name || databaseUser?.email}</strong></div>
            )
          ) : (
            <label className="workspace-switch">
              <span>Demo workspace</span>
              <select
                aria-label="Demo workspace"
                value={workspace}
                onChange={(e) => {
                  const next = e.target.value;
                  setWorkspace(next);
                  setNavigation({ page: next === 'Admin' ? 'Admin Operations' : next === 'Driver' ? 'Driver Overview' : 'Overview', history: [] });
                  setShowForm(false); setShowMobileNav(false); setNotice(''); setStatusFilter('All'); setSearch('');
                }}
              >
                <option value="Partner">Partner</option>
                <option value="Admin">Admin / Operations</option>
                <option value="Driver">Driver</option>
              </select>
            </label>
          )}
          <span className="breadcrumb">
            {workspace} / {page}
          </span>
          <button className="workspace-theme-toggle" type="button" aria-label="Switch theme" title="Switch theme" onClick={(event) => { const app = event.currentTarget.closest('.app'); const night = app.dataset.theme !== 'night'; app.dataset.theme = night ? 'night' : 'day'; localStorage.setItem('igo-theme', night ? 'night' : 'day'); event.currentTarget.textContent = night ? '☀' : '☾'; }}>{localStorage.getItem('igo-theme') === 'night' ? '☀' : '☾'}</button>{databaseProfile && <NotificationCenter onNavigate={handleNotificationNavigate} />}
<div className="profile-menu-container">
            <button
              type="button"
              className="profile-trigger"
              aria-label="Open profile menu"
              aria-haspopup="menu"
              aria-expanded={showProfileMenu}
              onClick={() => setShowProfileMenu((open) => !open)}
            >
              <span className="profile-avatar">
                {databaseProfile?.full_name?.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || (workspace === 'Admin' ? 'OP' : workspace === 'Driver' ? 'DR' : 'SH')}
              </span>
              <span className="profile-trigger-name">
                {''}
              </span>
              <span className="profile-chevron" aria-hidden="true">⌄</span>
            </button>
            {showProfileMenu && (
              <div className="profile-dropdown" role="menu">
                <div className="profile-dropdown-heading">
                  <strong>{viewedProfileName}</strong>
                  <span>{databaseUser?.email || workspace + ' profile'}</span>
                </div>
                {canShowWorkspaceSwitcher && (
                  <label className="profile-workspace-switch">
                    <span>View workspace</span>
                    <select
                      aria-label="Switch workspace"
                      value={workspace}
                      onChange={(event) => {
                        setShowProfileMenu(false);
                        void switchWorkspace(event.target.value);
                      }}
                    >
                      {availableWorkspaces.map((name) => <option key={name} value={name}>{name === 'Admin' ? 'Admin workspace' : name + ' workspace'}</option>)}
                    </select>
                  </label>
                )}
                <button type="button" role="menuitem" onClick={() => {
                  setPage(workspace === 'Driver' ? 'About' : 'Profile');
                  setShowProfileMenu(false);
                }}>Profile</button>
                {databaseProfile && <button type="button" className="profile-signout" role="menuitem" onClick={() => {
                  setShowProfileMenu(false);
                  void signOutFromDatabase();
                }}>Sign out / switch account</button>}
              </div>
            )}
          </div>
          
        </header>

        <section className="content">
          {partnerSetupOpen && databaseProfile?.role === 'admin' && (
            <div className="workspace-setup-backdrop">
              <form className="workspace-setup-card" role="dialog" aria-modal="true" aria-labelledby="partner-workspace-setup-title" onSubmit={saveAdminPartnerSetup}>
                <p className="approval-kicker">PARTNER WORKSPACE SETUP</p>
                <h2 id="partner-workspace-setup-title">Add your partner details</h2>
                <p>Use the usual partner application process for partner accounts. This setup creates the partner workspace linked to your admin account.</p>
                <label>Business or partner name<input autoComplete="organization" required maxLength={120} value={partnerBusinessName} onChange={(event) => setPartnerBusinessName(event.target.value)} /></label>
                <label>Business address<textarea autoComplete="street-address" required maxLength={500} rows={3} value={partnerBusinessAddress} onChange={(event) => setPartnerBusinessAddress(event.target.value)} /></label>
                {notice && <p className="notice" role="alert">{notice}</p>}
                <div className="workspace-setup-actions">
                  <button className="primary-btn" type="submit" disabled={partnerSetupBusy}>{partnerSetupBusy ? 'Saving details…' : 'Save partner details'}</button>
                  <button className="secondary-btn" type="button" disabled={partnerSetupBusy} onClick={() => { setPartnerSetupOpen(false); setWorkspace('Admin'); setNavigation({ page: 'Admin Operations', history: [] }); }}>Back to admin workspace</button>
                </div>
              </form>
            </div>
          )}
          <div className="eyebrow">
            {workspace === 'Admin'
              ? 'OPERATIONS WORKSPACE'
              : workspace === 'Staff'
              ? 'STAFF WORKSPACE'
              : workspace === 'Driver'
              ? 'DRIVER WORKSPACE'
              : 'PARTNER WORKSPACE'}
          </div>
          <h1>{page === 'Register Package' ? 'Register a package' : page === 'Staff Operations' ? 'Delivery Management Room' : page}</h1>
          <p className="subtitle">
            {workspace === 'Admin'
              ? 'Admin workspace.'
              : workspace === 'Driver'
              ? page === 'About'
                ? 'Profile and bank details.'
                : 'Assigned deliveries.'
              : workspace === 'Staff'
              ? page === 'Finance Management' ? 'Payment requests, approvals, and payouts.' : 'Tools depend on your assigned staff role.'
              : 'Packages and payments.'}
          </p>

          {notice && <div className="notice">{notice}</div>}

          {page === 'Profile' && (
            <section id="profile-details" className="profile-details-card">
              <h2>Profile</h2>
              <dl>
              <div><dt>Name</dt><dd>{viewedProfileName}</dd></div>
                {workspace === 'Partner' && linkedPartnerProfile?.contact_name && <div><dt>Contact name</dt><dd>{linkedPartnerProfile.contact_name}</dd></div>}
                {workspace === 'Driver' && linkedDriverProfile?.phone && <div><dt>Phone</dt><dd>{linkedDriverProfile.phone}</dd></div>}
                <div><dt>Email</dt><dd>{databaseUser?.email || 'Demo profile'}</dd></div>
                <div><dt>Profile</dt><dd>{viewedProfileType}</dd></div>
                </dl>
                {workspace === 'Partner' && databaseProfile?.role === 'partner' && (
                  <form className="profile-logo-editor" onSubmit={savePartnerLogoFromProfile}>
                    <h3>Business logo</h3>
                    <p>Add a logo to help drivers recognize your packages. PNG, JPEG, or WebP · up to 256 KB.</p>
                    {partnerLogo && <img src={partnerLogo} alt="Current partner logo" className="profile-logo-preview" />}
                    <label>Choose logo<input name="partner_logo" type="file" accept="image/png,image/jpeg,image/webp" required onChange={(event) => { setLogoFileSelected(Boolean(event.currentTarget.files?.[0])); setLogoFeedback(''); setNotice(''); }} /></label>
                    <p className="profile-logo-hint">{logoFileSelected ? 'Logo selected. Save to apply it.' : 'Choose an image above to enable the save button.'}</p>
                    <button className="secondary-btn" type="submit" disabled={logoSaving || !logoFileSelected}>{logoSaving ? 'Saving…' : partnerLogo ? 'Save logo' : 'Add logo'}</button>
                    {logoFeedback && <p className={'profile-logo-feedback ' + logoFeedbackKind} role={logoFeedbackKind === 'error' ? 'alert' : 'status'}>{logoFeedback}</p>}
                  </form>
                )}
                {databaseProfile?.role !== 'admin' && <ProfileChangeRequests profile={databaseProfile} user={databaseUser} workspace={workspace} setNotice={setNotice} />}
            </section>
          )}

          {databaseProfile?.role === 'admin' && workspace !== 'Admin' && !activeLinkedProfile && !partnerSetupOpen && (
            <div className="profile-preview-note" role="status">Set up your {workspace.toLowerCase()} workspace to use its account-specific features.</div>
          )}

          {workspace === 'Driver' && page === 'About' && (
            <DriverAbout driverName={viewedProfileName} liveMode={Boolean(databaseProfile)} />
          )}

          {workspace === 'Driver' &&
            ['Driver Overview', 'My Deliveries'].includes(page) && (
              <DriverWorkflowDashboard
                packages={newestPackages}
                driverName={viewedProfileName}
                liveMode={Boolean(databaseProfile)}
                onUpdate={updatePackageRecord}
              />
            )}

          {(page === 'Finance Management' ||
            page === 'Accounts & Finance' ||
            page === 'Accounts') &&
            (workspace === 'Admin' || workspace === 'Staff') && (
              <SectionErrorBoundary>
                {workspace === 'Admin' && <FinanceManagement packages={packages} workspace={workspace} liveMode={Boolean(databaseProfile)} />}
                <StaffOperations user={databaseUser} profile={databaseProfile} isOwner={isSuperadmin} view="finance" />
              </SectionErrorBoundary>
            )}

          {page === 'Approvals' && workspace === 'Admin' && (
            <ApprovalDashboard />
          )}

          {page === 'User Management' && workspace === 'Admin' && (
            <section id="user-management" style={{ display: 'grid', gap: 20 }}>
              <header>
                <p className="eyebrow">ADMIN WORKSPACE</p>
                
                <p>Invite users, review pending accounts, and manage profile change requests.</p>
              </header>
              <AdminDriverRoster packages={newestPackages} liveMode={Boolean(databaseProfile)} />
              <ManagedIgoAccounts />
              <PendingIgoUserApprovals />
              <SuperadminUserManagementAccess />
              <ProfileChangeRequests profile={databaseProfile} user={databaseUser} workspace={workspace} setNotice={setNotice} />
              <StaffOperations user={databaseUser} profile={databaseProfile} isOwner={isSuperadmin} view="people" />
            </section>
          )}


          {page === 'Staff Operations' && workspace === 'Staff' && (
            <>
              {['operations_manager', 'operations_staff'].some((role) => staffRoles.has(role)) && <AdminOperations packages={newestPackages} liveMode={Boolean(databaseProfile)} staffMode onUpdate={updatePackageRecord} />}
              <StaffOperations user={databaseUser} profile={databaseProfile} view="staff" />
            </>
          )}

          {page === 'Admin Operations' && workspace === 'Admin' && (
            <AdminOperations
              packages={newestPackages}
              liveMode={Boolean(databaseProfile)}
              onUpdate={updatePackageRecord}
            />
          )}
          {page === 'Overview' && (
            <>
              <div className="welcome-card">
                <div>
                  <h2>Packages at a glance</h2>
                  <button
                    className="primary-btn"
                    onClick={() => {
                      setPage('Register Package');
                      setShowForm(true);
                    }}
                  >
                    Register package
                  </button>
                </div>
              </div>

              <div
                className="stats-grid overview-summary"
                aria-label="Delivery summary"
              >
                <Stat
                  label="Pending deliveries"
                  value={
                    packages.filter(
                      (p) => !['Delivered', 'Cancelled'].includes(p.status)
                    ).length
                  }
                  detail="Undelivered"
                  onClick={() => openPackageSummary('Active')}
                />
                <Stat
                  label="Out for delivery"
                  value={
                    packages.filter((p) => p.status === 'Out for Delivery')
                      .length
                  }
                  detail="Currently on the way"
                  onClick={() => openPackageSummary('Out for Delivery')}
                />
                <Stat
                  label="Delivered"
                  value={delivered}
                  detail="Delivered"
                  onClick={() => openPackageSummary('Delivered')}
                />
                <Stat
                  label="Total packages"
                  value={total}
                  detail="All packages"
                  onClick={() => openPackageSummary()}
                />
                <Stat
                  label="Estimated delivery fees"
                  value={`MVR ${outstanding.toLocaleString()}`}
                  detail="Estimate only"
                  scrollTarget="delivery-fee-estimates"
                  onClick={() => {
                    setShowEstimateList(true);
                    setPage('Invoices & Payments');
                    setShowForm(false);
                  }}
                />
                <Stat
                  label="Invoices & payments"
                  value={partnerPendingPaymentCount > 0
                    ? partnerPendingPaymentCount + ' pending payment' + (partnerPendingPaymentCount === 1 ? '' : 's')
                    : 'View invoices'}
                  detail={partnerPendingPaymentCount > 0
                    ? 'Awaiting admin review'
                    : 'No payments awaiting review'}
                  onClick={() => {
                    setPage('Invoices & Payments');
                    setShowForm(false);
                  }}
                />
              </div>

              <div className="section-heading">
                <div>
                  <h2>Recent packages</h2>
                </div>
                <button
                  className="primary-btn"
                  onClick={() => openPackageSummary()}
                >
                  View packages
                </button>
              </div>
              <PackageTable packages={newestPackages.slice(0, 5)} />
            </>
          )}

          {page === 'Register Package' && (
            <>
              <div className="package-import-actions">
                {showForm && (
                  <details className="bulk-upload-panel message-import-panel">
                    <summary>Fill from customer message</summary>
                    <div className="message-import-body">
                      <p>
                        Paste a message from WhatsApp, Instagram, or Facebook to
                        create a draft. Review the details, add more packages,
                        then confirm them all together.
                      </p>
                      <textarea
                        ref={customerMessageInputRef}
                        value={messageDraft}
                        onChange={(event) =>
                          setMessageDraft(event.target.value)
                        }
                        rows="4"
                        placeholder={
                          'Name: ...\nPhone: ...\nDestination: ...\nAddress: ...\nLandmark: ...\nFor Boat use Boat name:, Boat location:, Departure time: instead of Address.\nPackage: ...\nInstructions: ...'
                        }
                      />
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={fillFromMessage}
                      >
                        Add package to list
                      </button>
                      {messageNotice && (
                        <p className="bulk-notice" role="status">
                          {messageNotice}
                        </p>
                      )}
                    </div>
                  </details>
                )}
                {showForm && messageQueue.length > 0 && (
                  <section className="message-queue-panel">
                    <div className="message-queue-heading">
                      <strong>Packages to add ({messageQueue.length})</strong>
                      <button
                        type="button"
                        onClick={() => {
                          setMessageQueue([]);
                          setConfirmBulkAdd(false);
                        }}
                      >
                        Clear list
                      </button>
                    </div>
                    <div className="message-queue-list">
                      {messageQueue.map((entry, index) => (
                        <div className="message-queue-row" key={entry.queueId}>
                          <div className="message-queue-row-title">
                            <strong>Package {index + 1}</strong>
                            <button
                              type="button"
                              onClick={() =>
                                setMessageQueue((current) =>
                                  current.filter(
                                    (item) => item.queueId !== entry.queueId
                                  )
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>
                          <label>
                            Name
                            <input
                              value={entry.customer}
                              onChange={(event) =>
                                updateQueuedPackage(
                                  entry.queueId,
                                  'customer',
                                  event.target.value
                                )
                              }
                            />
                          </label>
                          <label>
                            Phone
                            <input
                              type="tel"
                              inputMode="tel"
                              pattern="[79][0-9]{6}"
                              title="Enter 7 digits starting with 7 or 9."
                              value={entry.phone}
                              onChange={(event) =>
                                updateQueuedPackage(
                                  entry.queueId,
                                  'phone',
                                  event.target.value
                                )
                              }
                            />
                          </label>
                          <label>
                            Island / area *
                            <select
                              value={entry.area}
                              onChange={(event) =>
                                updateQueuedPackage(
                                  entry.queueId,
                                  'area',
                                  event.target.value
                                )
                              }
                            >
                              <option>Malé</option>
                              <option>Hulhumalé Phase 1</option>
                              <option>Hulhumalé Phase 2</option>
                              <option>Boat</option>
                            </select>
                          </label>
                          {(entry.area === 'Boat'
                            ? [
                                ['boatName', 'Boat name *'],
                                ['boatLocation', 'Boat location (optional)'],
                                ['departureTime', 'Departure time (optional)'],
                              ]
                            : [
                                ['address', 'Delivery address *'],
                                ['landmark', 'Nearby landmark (optional)'],
                              ]
                          ).map(([field, label]) => (
                            <label key={field}>
                              {label}
                              <input
                                value={entry[field] || ''}
                                required={
                                  field === 'address' || field === 'boatName'
                                }
                                placeholder={
                                  field === 'departureTime'
                                    ? 'HH:MM or 2:30 PM'
                                    : undefined
                                }
                                onChange={(event) =>
                                  updateQueuedPackage(
                                    entry.queueId,
                                    field,
                                    event.target.value
                                  )
                                }
                              />
                            </label>
                          ))}
                          <p className="message-queue-fee">
                            Delivery fee: MVR {entry.fee}
                          </p>
                          {entry.item && <p>Package: {entry.item}</p>}
                          {entry.notes && <p>Instructions: {entry.notes}</p>}
                        </div>
                      ))}
                    </div>
                    {!confirmBulkAdd ? (
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={() => setConfirmBulkAdd(true)}
                      >
                        Review and confirm {messageQueue.length} packages
                      </button>
                    ) : (
                      <div className="message-queue-confirm">
                        <p>
                          Confirm adding {messageQueue.length} packages to the
                          package list?
                        </p>
                        <button
                          type="button"
                          className="primary-btn"
                          onClick={confirmAddQueuedPackages}
                        >
                          Confirm and add all
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmBulkAdd(false)}
                        >
                          Back to review
                        </button>
                      </div>
                    )}
                  </section>
                )}
                {showForm && (
                  <details className="bulk-upload-panel">
                    <summary>
                      <span aria-hidden="true">▤</span> Bulk
                    </summary>
                    <div>
                      <h3>Add packages in bulk</h3>
                      <p>
                        Download the template, fill in one row per package in
                        Excel, then save it as CSV and upload it here. For Boat,
                        fill Boat name; location and departure time are
                        optional. For other destinations, fill Delivery address;
                        Nearby landmark is optional. Use HH:MM or AM/PM for
                        departure times. Fees are calculated automatically.
                      </p>
                    </div>
                    <div className="bulk-upload-actions">
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={downloadBulkTemplate}
                      >
                        Download spreadsheet template
                      </button>
                      <label className="bulk-file-label">
                        Upload completed spreadsheet (.csv)
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          onChange={handleBulkUpload}
                        />
                      </label>
                    </div>
                    {bulkNotice && (
                      <p className="bulk-notice" role="status">
                        {bulkNotice}
                      </p>
                    )}
                  </details>
                )}
              </div>
              {showForm && (
                <form
                  className="package-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    registerPackage(e);
                  }}
                  onInput={(e) => e.target.setCustomValidity?.('')}
                  onKeyDown={(e) => {
                    if (
                      e.key !== 'Enter' ||
                      e.nativeEvent.isComposing ||
                      e.altKey ||
                      e.ctrlKey ||
                      e.metaKey ||
                      e.shiftKey ||
                      !e.target.matches('input, select')
                    )
                      return;
                    e.preventDefault();
                    const field = e.target;
                    field.setCustomValidity(
                      field.required && !field.value.trim()
                        ? 'Please fill in this field before continuing.'
                        : ''
                    );
                    if (!field.reportValidity()) return;
                    const fields = Array.from(
                      e.currentTarget.querySelectorAll(
                        'input:not([readonly]):not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button[type="submit"]'
                      )
                    );
                    const index = fields.indexOf(e.target);
                    if (index >= 0) fields[index + 1]?.focus();
                  }}
                >
                  {' '}
                  <h3>Customer and delivery details</h3>
                  <div className="form-grid">
                    <label>
                      Customer name *
                      <input
                        ref={customerNameInputRef}
                        name="customer"
                        value={form.customer}
                        onChange={updateForm}
                        required
                        placeholder="Full name"
                      />
                    </label>
                    <label>
                      Customer phone *
                      <input
                        type="tel"
                        inputMode="tel"
                        pattern="[79][0-9]{6}"
                        title="Enter 7 digits starting with 7 or 9."
                        name="phone"
                        value={form.phone}
                        onChange={updateForm}
                        required
                        placeholder="Phone number"
                      />
                    </label>
                    <label className="full-width">
                      Island / area *
                      <select
                        name="area"
                        value={form.area}
                        onChange={updateForm}
                        required
                      >
                        <option>Malé</option>
                        <option>Hulhumalé Phase 1</option>
                        <option>Hulhumalé Phase 2</option>
                        <option>Boat</option>
                      </select>
                    </label>
                    {form.area === 'Boat' ? (
                      <>
                        <label className="full-width">
                          Boat name *
                          <input
                            name="boatName"
                            value={form.boatName}
                            onChange={updateForm}
                            required
                            placeholder="Name of the boat"
                          />
                        </label>
                        <label>
                          Boat location (optional)
                          <input
                            name="boatLocation"
                            value={form.boatLocation}
                            onChange={updateForm}
                            placeholder="Harbour, jetty or pickup point"
                          />
                        </label>
                        <label>
                          Departure time (optional)
                          <input
                            type="time"
                            name="departureTime"
                            value={form.departureTime}
                            onChange={updateForm}
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <label className="full-width">
                          Delivery address *
                          <input
                            name="address"
                            value={form.address}
                            onChange={updateForm}
                            required
                            placeholder="House, street or building"
                          />
                        </label>
                        <label className="full-width">
                          Nearby landmark (optional)
                          <input
                            name="landmark"
                            value={form.landmark}
                            onChange={updateForm}
                            placeholder="A nearby shop, mosque or other landmark"
                          />
                        </label>
                      </>
                    )}
                    <label className="full-width">
                      Delivery instructions
                      <textarea
                        name="notes"
                        value={form.notes}
                        onChange={updateForm}
                        placeholder="Optional notes for the driver"
                        rows="3"
                      />
                    </label>
                    <label>
                      Package description (optional)
                      <input
                        name="item"
                        value={form.item}
                        onChange={updateForm}
                        placeholder="e.g. Clothing order"
                      />
                    </label>
                    <label>
                      Delivery fee (MVR) *
                      <input
                        type="text"
                        value={form.fee}
                        readOnly
                        aria-label="Calculated delivery fee in MVR"
                      />
                    </label>
                  </div>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => {
                        setShowForm(false);
                        setPage(
                          workspace === 'Admin'
                            ? 'Admin Operations'
                            : 'Overview'
                        );
                      }}
                    >
                      Cancel
                    </button>
                    <button className="primary-btn" type="submit">
                      Add package
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {page === 'Packages' && (
            <>
              <div className="toolbar">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search ID, customer, phone, partner or area..."
                />
                <button
                  className="primary-btn"
                  onClick={() => {
                    setPage('Register Package');
                    setShowForm(true);
                  }}
                >
                  + Register
                </button>
              </div>
              <div id="package-list" className="package-filter-bar">
                <label htmlFor="package-status-filter">Show</label>
                <select
                  id="package-status-filter"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="All">All packages</option>
                  <option value="Active">Pending deliveries</option>
                  {[...new Set(packages.map((p) => p.status))].map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <label htmlFor="package-partner-filter">Partner</label>
                <select
                  id="package-partner-filter"
                  value={partnerFilter}
                  onChange={(event) => setPartnerFilter(event.target.value)}
                >
                  <option value="All">All partners</option>
                  {[...new Map(packages.map((p) => [
                    String(p.partnerId || p.partnerName || p.partner || 'Unknown partner'),
                    p.partnerName || p.partner || 'Unknown partner',
                  ])).entries()].map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <label htmlFor="package-driver-filter">Driver</label>
                <select
                  id="package-driver-filter"
                  value={driverFilter}
                  onChange={(event) => setDriverFilter(event.target.value)}
                >
                  <option value="All">All drivers</option>
                  <option value="__unassigned__">Unassigned</option>
                  {[...new Set(packages.map((p) => p.driver).filter(Boolean))].sort().map((driver) => (
                    <option key={driver} value={driver}>{driver}</option>
                  ))}
                </select>
                <label htmlFor="package-area-filter">Area</label>
                <select
                  id="package-area-filter"
                  value={areaFilter}
                  onChange={(event) => setAreaFilter(event.target.value)}
                >
                  <option value="All">All areas</option>
                  {[...new Set(packages.map((p) => p.area).filter(Boolean))].sort().map((area) => (
                    <option key={area} value={area}>{area}</option>
                  ))}
                </select>
                <span aria-live="polite">{filtered.length} package(s)</span>
              </div>
              <PackageTable packages={filtered} />
            </>
          )}

          {page === 'Invoices & Payments' && (
            <>
              <div className="stats-grid">
                {workspace !== 'Admin' && <Stat
                  label="Estimated delivery fees"
                  value={`MVR ${outstanding.toLocaleString()}`}
                  detail={`${estimatedPackages.length} package(s) not yet invoiced`}
                  scrollTarget="delivery-fee-estimates"
                  onClick={() => setShowEstimateList(true)}
                />}
                {workspace === 'Partner' && (
                  <Stat
                    label="Amount due"
                    value={`MVR ${partnerAmountDue.toLocaleString()}`}
                    detail={`${delivered} delivered · invoice & payment options`}
                    scrollTarget={
                      partnerAmountDue > 0
                        ? 'partner-invoice-payment-options'
                        : 'partner-invoices-list'
                    }
                    onClick={() => {}}
                  />
                )}
                {workspace === 'Partner' && (
                  <div className="stat-card" aria-label="Total spent">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span className="stat-label">Total spent</span>
                      <select
                        aria-label="Total spent duration"
                        value={partnerSpendPeriod}
                        onChange={(event) => {
                          const period = event.target.value;
                          setPartnerSpendPeriod(period);
                          setPartnerTotalSpent(
                            getPartnerSpentFromStorage(period)
                          );
                        }}
                        style={{
                          maxWidth: 106,
                          padding: '4px 6px',
                          border: '1px solid #dfe5e1',
                          borderRadius: 6,
                          background: '#fff',
                          color: '#566157',
                          fontSize: 11,
                        }}
                      >
                        <option value="all">All time</option>
                        <option value="week">Last 7 days</option>
                        <option value="month">This month</option>
                        <option value="last3">Last 3 months</option>
                        <option value="year">This year</option>
                      </select>
                    </div>
                    <strong>MVR {partnerTotalSpent.toLocaleString()}</strong>
                    <small>{databaseProfile ? 'Confirmed payments' : 'Confirmed payments · demo'}</small>
                  </div>
                )}
              </div>
              {showEstimateList && (
                <section
                  id="delivery-fee-estimates"
                  className="simple-list"
                  aria-label="Delivery fee estimates"
                  style={{ marginTop: 16 }}
                >
                  <h2 style={{ fontSize: 18, marginBottom: 6 }}>
                    Delivery fee estimates
                  </h2>
                  <p style={{ fontSize: 12 }}>
                    Packages not yet invoiced · {estimatedPackages.length}{' '}
                    package(s)
                  </p>
                  {estimatedPackages.length ? (
                    Object.entries(
                      estimatedPackages.reduce((groups, p) => {
                        const partner =
                          p.partnerName || p.partner || 'Style Hub';
                        (groups[partner] ||= []).push(p);
                        return groups;
                      }, {})
                    ).map(([partner, partnerPackages]) => (
                      <div
                        key={partner}
                        style={{
                          borderTop: '1px solid #e7e9e5',
                          paddingTop: 12,
                          marginTop: 12,
                        }}
                      >
                        <h3 style={{ display: 'inline-block', margin: '0 0 8px', fontSize: 15 }}>{partner}</h3>
                        {partnerPackages.map((p) => (
                          <article
                            key={p.id}
                            className="application-card"
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              gap: 16,
                              alignItems: 'center',
                              padding: 14,
                              marginBottom: 8,
                              fontSize: 13,
                            }}
                          >
                            <div>
                              <strong style={{ fontSize: 14 }}>
                                {p.id} ·{' '}
                                {p.customer || p.customer_name || 'Customer'}
                              </strong>
                              <div style={{ fontSize: 12 }}>{p.status}</div>
                            </div>
                            <strong style={{ fontSize: 13 }}>
                              MVR{' '}
                              {Number(
                                p.fee || p.delivery_fee || 0
                              ).toLocaleString()}
                            </strong>
                          </article>
                        ))}
                      </div>
                    ))
                  ) : (
                    <p>No packages are currently awaiting an invoice.</p>
                  )}
                </section>
              )}
              <div className="simple-list">
                <h2>Invoices and payments</h2>
                <p>{databaseProfile ? 'Official invoices and payment status from your account.' : 'Official records appear after database setup.'}</p>
                <SectionErrorBoundary><FinanceManagement packages={packages} workspace={workspace} liveMode={Boolean(databaseProfile)} mode="invoices" /></SectionErrorBoundary>
              </div>
            </>
          )}

          <footer>
            iGO Delivery · {databaseProfile ? 'Connected to Supabase' : 'Demo workspace'}
          </footer>
        </section>
      </main>
      {navigation.history.length > 0 && (
        <button
          type="button"
          className="floating-back"
          onClick={goBack}
          aria-label={`Go back to ${
            navigation.history[navigation.history.length - 1].page
          }`}
        >
          <span aria-hidden="true">←</span> Back
        </button>
      )}
      {showGoToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Go to top"
          title="Go to top"
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            zIndex: 1000,
            width: 48,
            height: 48,
            border: 0,
            borderRadius: '50%',
            background: '#174f39',
            color: '#fff',
            fontSize: 24,
            lineHeight: 1,
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.22)',
          }}
        >
          ↑
        </button>
      )}
    </div>
  );
}

function ManagedIgoAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [canPromoteAdmins, setCanPromoteAdmins] = useState(false);
  const [superadminIds, setSuperadminIds] = useState([]);
  const [accessDrafts, setAccessDrafts] = useState({});

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const loadedAccounts = await loadManagedUserAccounts();
      setAccounts(loadedAccounts);
      setAccessDrafts(Object.fromEntries(loadedAccounts.filter((account) => account.type === 'Admin').map((account) => [account.accountId, {
        role: account.adminRole || 'admin',
        workspaces: account.workspaceAccess || (account.adminRole === 'staff' ? ['Staff'] : ['Admin', 'Partner', 'Driver']),
        workspaceSwitcherVisible: account.workspaceSwitcherVisible !== false,
      }])));
      const { data: isSuperadmin, error: roleError } = await supabase.rpc('is_igo_superadmin');
      if (roleError) throw roleError;
      setCanPromoteAdmins(isSuperadmin === true);
      if (isSuperadmin === true) {
        const { data: ids, error: idsError } = await supabase.rpc('list_igo_superadmin_user_ids');
        if (idsError) throw idsError;
        setSuperadminIds((ids || []).map((row) => row.user_id));
      } else {
        setSuperadminIds([]);
      }
    } catch (loadError) {
      setError(loadError.message || 'Could not load user accounts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const changeStatus = async (account) => {
    const nextStatus = account.status === 'approved' ? 'suspended' : 'approved';
    setBusyId(account.accountId);
    setMessage('');
    setError('');
    try {
      await setAccountApproval(account.type, account.accountId, nextStatus);
      await refresh();
      setMessage(`${account.type === 'Driver' ? 'Rider' : 'Partner'} account ${nextStatus === 'approved' ? 'reactivated' : 'suspended'}.`);
    } catch (changeError) {
      setError(changeError.message || 'Could not update this account.');
    } finally {
      setBusyId('');
    }
  };

  const updateAccessDraft = (accountId, patch) => setAccessDrafts((current) => ({
    ...current,
    [accountId]: { ...(current[accountId] || {}), ...patch },
  }));

  const saveAdminAccess = async (account) => {
    const draft = accessDrafts[account.accountId];
    if (!draft) return;
    setBusyId(account.accountId);
    setMessage('');
    setError('');
    try {
      const { error: saveError } = await supabase.rpc('set_igo_managed_admin_access', {
        p_user_id: account.accountId,
        p_role: draft.role,
        p_workspace_access: draft.workspaces,
        p_workspace_switcher_visible: draft.workspaceSwitcherVisible,
      });
      if (saveError) throw saveError;
      await refresh();
      setMessage(`${account.name || 'Account'} access updated.`);
    } catch (saveError) {
      setError(saveError.message || 'Could not update this account access.');
    } finally {
      setBusyId('');
    }
  };

  const promoteAdmin = async (account) => {
    setBusyId(account.accountId);
    setMessage('');
    setError('');
    try {
      const { error: promoteError } = await supabase.rpc('promote_igo_admin_to_superadmin', {
        p_user_id: account.accountId,
      });
      if (promoteError) throw promoteError;
      await refresh();
      setMessage(`${account.name || 'Admin'} was promoted to superadmin.`);
    } catch (promoteError) {
      setError(promoteError.message || 'Could not promote this admin account.');
    } finally {
      setBusyId('');
    }
  };

  const managed = accounts.filter((account) =>
    account.type === 'Admin' || account.status === 'approved' || account.status === 'suspended'
  );
  const visible = managed.filter((account) => {
    const matchesType = typeFilter === 'all' ||
      (typeFilter === 'partners' && account.type === 'Partner') ||
      (typeFilter === 'riders' && account.type === 'Driver') ||
      (typeFilter === 'admins' && account.type === 'Admin');
    const matchesStatus = filter === 'all' || account.status === filter;
    const query = search.trim().toLowerCase();
    const searchable = [account.name, account.contact_name, account.phone, account.email, account.type === 'Driver' ? 'Rider' : account.type]
      .filter(Boolean).join(' ').toLowerCase();
    return matchesType && matchesStatus && (!query || searchable.includes(query));
  });

  return (
    <section className="card managed-account-panel" style={{ marginBottom: '1.25rem', padding: 20 }}>
      <div className="ops-heading">
        <div>
          <h2>User accounts</h2>
          <p>Find partners, riders, and admins. Suspend or restore partner and rider access.</p>
        </div>
        <button type="button" className="secondary-btn" onClick={refresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'end', gap: 12, flexWrap: 'wrap', margin: '12px 0' }}>
        <label style={{ flex: '1 1 220px' }}>Search accounts
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, phone, or email"
            aria-label="Search partner, rider, and admin accounts by name, phone, or email"
          />
        </label>
        <label>Show status<select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All</option>
          <option value="approved">Approved</option>
          <option value="suspended">Suspended</option>
        </select></label>
      </div>
      <div role="group" aria-label="Quick filter by account type" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {[
          ['all', 'All'],
          ['partners', 'Partners'],
          ['riders', 'Riders'],
          ['admins', 'Admins'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={typeFilter === value ? 'primary-btn' : 'secondary-btn'}
            aria-pressed={typeFilter === value}
            onClick={() => setTypeFilter(value)}
          >{label}</button>
        ))}
      </div>
      {message && <p role="status" className="notice">{message}</p>}
      {error && <p role="alert" className="notice">{error}</p>}
      {loading ? <p>Loading accounts…</p> : visible.length ? (
        <div className="managed-account-list">
          {visible.map((account) => {
            const isAdmin = account.type === 'Admin';
            const approved = account.status === 'approved';
            return (
              <article
                key={`managed-${account.type}-${account.accountId}`}
                className="managed-account-row"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderTop: '1px solid #64748b', padding: '12px 0' }}
              >
                <div className="managed-account-info" style={{ flex: '1 1 230px', minWidth: 0 }}>
                  <strong>{account.name || account.contact_name || 'Unnamed account'}</strong>
                  <p style={{ margin: '4px 0 0' }}>{account.type === 'Driver' ? 'Rider' : account.type}</p>
                  <p style={{ margin: '4px 0 0', overflowWrap: 'anywhere' }}>Email: {account.email || 'Not provided'}</p>
                  <p style={{ margin: '4px 0 0', overflowWrap: 'anywhere' }}>Phone: {account.phone || 'Not provided'}</p>
                  {isAdmin && <small style={{ display: 'block', marginTop: 4, color: '#94a3b8' }}>
                    {account.addedByName
                      ? `Added by ${account.addedByName}${account.addedByEmail ? ` · ${account.addedByEmail}` : ''}`
                      : 'Inviter not recorded'}
                    {account.invitedAt ? ` · ${new Date(account.invitedAt).toLocaleDateString()}` : ''}
                  </small>}
                </div>
                <span
                  className={`status status-${statusClass(account.status)}`}
                  style={{
                    flex: '0 0 auto',
                    background: isAdmin ? '#1d4ed8' : approved ? '#166534' : '#9a3412',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 12,
                    padding: '5px 10px',
                  }}
                >{isAdmin && superadminIds.includes(account.accountId) ? 'Superadmin' : isAdmin ? (account.adminRole === 'staff' ? 'Staff' : 'Admin') : account.status}</span>
                {isAdmin && canPromoteAdmins && !superadminIds.includes(account.accountId) && !account.workspaceAccessReady && <p style={{ flex: '1 1 100%' }}>Apply the admin workspace access database update to manage this account.</p>}
                {isAdmin && canPromoteAdmins && !superadminIds.includes(account.accountId) && account.workspaceAccessReady && <div className="managed-admin-access" style={{ flex: '1 1 100%', border: '1px solid #64748b', borderRadius: 12, padding: 12 }}>
                  <strong>Admin and staff access</strong>
                  <p style={{ margin: '6px 0' }}>Staff mode keeps only assigned staff tools. Admin mode restores admin functions.</p>
                  <label style={{ display: 'block', marginTop: 8 }}>Account mode
                    <select value={accessDrafts[account.accountId]?.role || account.adminRole || 'admin'} onChange={(event) => {
                      const role = event.target.value;
                      updateAccessDraft(account.accountId, { role, workspaces: role === 'staff' ? ['Staff'] : ['Admin', 'Partner', 'Driver'], workspaceSwitcherVisible: role === 'admin' });
                    }}>
                      <option value="admin">Admin functions</option>
                      <option value="staff">Staff roles only</option>
                    </select>
                  </label>
                  <fieldset style={{ display: 'flex', gap: 12, flexWrap: 'wrap', border: 0, padding: '8px 0 0' }}>
                    <legend>Workspaces they can use</legend>
                    {(accessDrafts[account.accountId]?.role === 'staff'
                      ? [['Staff', true]]
                      : [['Admin', true], ['Partner', false], ['Driver', false]]
                    ).map(([name, required]) => {
                      const draft = accessDrafts[account.accountId] || {};
                      const checked = (draft.workspaces || []).includes(name);
                      return <label key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={checked} disabled={required} onChange={(event) => updateAccessDraft(account.accountId, { workspaces: event.target.checked ? [...(draft.workspaces || []), name] : (draft.workspaces || []).filter((item) => item !== name) })} />
                        {name}{required ? ' (required)' : ''}
                      </label>;
                    })}
                  </fieldset>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <input type="checkbox" checked={accessDrafts[account.accountId]?.workspaceSwitcherVisible !== false} disabled={accessDrafts[account.accountId]?.role === 'staff'} onChange={(event) => updateAccessDraft(account.accountId, { workspaceSwitcherVisible: event.target.checked })} />
                    Show workspace switcher
                  </label>
                  <button type="button" className="primary-btn" style={{ marginTop: 8 }} disabled={busyId === account.accountId} onClick={() => saveAdminAccess(account)}>
                    {busyId === account.accountId ? 'Saving…' : 'Save access'}
                  </button>
                </div>}
                {isAdmin && canPromoteAdmins && account.adminRole === 'admin' && !superadminIds.includes(account.accountId) && <button
                  type="button"
                  className="primary-btn"
                  disabled={busyId === account.accountId}
                  onClick={() => promoteAdmin(account)}
                  title="Grant this admin superadmin access"
                >
                  {busyId === account.accountId ? 'Promoting…' : 'Promote to superadmin'}
                </button>}
                {!isAdmin && <button
                  type="button"
                  className={approved ? 'secondary-btn' : 'primary-btn'}
                  disabled={busyId === account.accountId}
                  onClick={() => changeStatus(account)}
                >
                  {busyId === account.accountId ? 'Saving…' : approved ? 'Suspend' : 'Reactivate'}
                </button>}
              </article>
            );
          })}
        </div>
      ) : <p>{search.trim() ? 'No accounts match that search.' : 'No accounts match the selected filters.'}</p>}
    </section>
  );
}

function ApprovalDashboard() {
  const [accounts, setAccounts] = useState([]);
  const [status, setStatus] = useState('pending');
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    setLoading(true);
    try {
      setAccounts(await loadApprovalAccounts());
      setMessage('');
    } catch (error) {
      setMessage(error.message || 'Could not load account applications.');
    } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const decide = async (account, nextStatus) => {
    setBusyId(account.accountId); setMessage('');
    try {
      await setAccountApproval(account.type, account.accountId, nextStatus);
      await refresh();
      setMessage(`${account.type} ${nextStatus}.`);
    } catch (error) { setMessage(error.message || 'Could not update approval.'); }
    finally { setBusyId(''); }
  };
  const visible = accounts.filter((account) => status === 'all' || account.status === status);
  return (
    <section id="pending-account-approvals" className="accounts-dashboard" style={{ padding: 24 }}>
      <p className="approval-kicker">ADMIN WORKSPACE · LIVE</p>
      <h2>Pending user approvals</h2>
      <label>Show<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="suspended">Suspended</option><option value="all">All</option></select></label>
      {message && <p role="status" className="notice">{message}</p>}
      {loading ? <p>Loading accounts…</p> : visible.length ? visible.map((account) => (
        <article className="application-card" key={`${account.type}-${account.accountId}`} style={{ padding: 16, marginTop: 12 }}>
          <div>
            <strong>{account.name}</strong>
            {account.contact_name && <p>Contact: {account.contact_name}</p>}
            <p>{account.type}</p>
            <p>Email: {account.email || 'Not provided'}</p>
            <p>Phone: {account.phone || 'Not provided'}</p>
            <span className={`status status-${statusClass(account.status)}`}>{account.status}</span>
          </div>
          <div className="finance-report-actions">
            {account.status === 'suspended'
              ? <button className="primary-btn" disabled={busyId === account.accountId} onClick={() => decide(account, 'approved')}>Reactivate</button>
              : account.status !== 'approved' && <button className="primary-btn" disabled={busyId === account.accountId} onClick={() => decide(account, 'approved')}>Approve</button>}
            {account.status !== 'rejected' && account.status !== 'suspended' && <button className="secondary-btn" disabled={busyId === account.accountId} onClick={() => decide(account, 'rejected')}>Reject</button>}
            {account.status === 'approved' && <button className="secondary-btn" disabled={busyId === account.accountId} onClick={() => decide(account, 'suspended')}>Suspend</button>}
          </div>
        </article>
      )) : <p>{status === 'pending' ? 'No pending accounts.' : 'No accounts in this status.'}</p>}
    </section>
  );
}

function AdminOperations({ packages, onUpdate, liveMode = false, staffMode = false }) {
  const [driverNames, setDriverNames] = useState([]); const [activeDriverField, setActiveDriverField] = useState(''); useEffect(() => { if (!liveMode) return undefined; let active = true; const refreshDrivers = async () => { try { const rows = staffMode ? (await supabase.from('drivers').select('name').eq('active', true).eq('approval_status', 'approved').order('name')).data || [] : await loadDriverRoster(); if (active) setDriverNames([...new Set(rows.map((driver) => driver.name).filter(Boolean))]); } catch {} }; void refreshDrivers(); const timer = window.setInterval(() => void refreshDrivers(), 15000); return () => { active = false; window.clearInterval(timer); }; }, [liveMode]); const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [area, setArea] = useState('All');
  const [drafts, setDrafts] = useState({});
  const [paymentReviewDrafts, setPaymentReviewDrafts] = useState({});
  const [feedback, setFeedback] = useState('');
  const statuses = [
    'Pending',
    'Picked Up',
    'Out for Delivery',
    'Delivered',
    'Failed Delivery',
    'Returned to Godown',
    'Cancelled',
  ];
  const active = (p) => !['Delivered', 'Cancelled'].includes(p.status);
  const matchesFilter = (p, value) =>
    value === 'All' ||
    (value === 'Active'
      ? ['Picked Up', 'Out for Delivery'].includes(p.status)
      : value === 'Pending Pickup' ? p.status === 'Pending' && Boolean(p.driver?.trim()) : value === 'Unassigned'
      ? active(p) && !p.driver?.trim()
      : value === 'Boat'
      ? active(p) && p.area === 'Boat'
      : p.status === value);
  const count = (value) =>
    packages.filter((p) => matchesFilter(p, value)).length;
  const filtered = packages.filter(
    (p) =>
      matchesFilter(p, filter) &&
      (area === 'All' || p.area === area) &&
      [p.id, p.customer, p.phone, p.address, p.area, p.boatName, p.driver]
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase())
  );
  const change = (p, field, value) => {
    setDrafts((current) => ({
      ...current,
      [p.id]: {
        ...(current[p.id] || {
          driver: p.driver || '',
          status: p.status,
          failureReason: p.failureReason || '',
          handoverPhoto: p.handoverPhoto || '',
        }),
        [field]: value,
      },
    }));
    setFeedback('');
  };
  const selectPhoto = (p, file) => {
    if (!file) {
      change(p, 'handoverPhoto', '');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setFeedback('Please choose an image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => change(p, 'handoverPhoto', reader.result);
    reader.readAsDataURL(file);
  };
  const selectSummary = (value) => {
    setFilter(value);
    setArea('All');
    setQuery('');
  };
  return (
    <div className="operations-dashboard">
      <div className="stats-grid overview-summary">
        {[
          ['Needs assignment', 'Unassigned', 'Waiting for a driver'],
          ['Pending pickup', 'Pending Pickup', 'Assigned and awaiting collection'],
          ['Ongoing deliveries', 'Active', 'Picked up or on the way'],
          ['Delivered', 'Delivered', 'Delivered'],
          ['Failed deliveries', 'Failed Delivery', 'Needs review'],
          ['Total packages', 'All', 'All packages'],
        ].map(([label, value, detail]) => (
          <Stat
            key={value}
            label={label}
            value={count(value)}
            detail={detail}
            onClick={() => selectSummary(value)}
          />
        ))}
      </div>
      
      
      <div className="ops-heading">
        <div>
          <h2 id="dispatch-queue-heading">Dispatch & delivery queue</h2>
          <p>Assign drivers and update statuses.</p>
        </div>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => selectSummary('Boat')}
        >
          Boat handovers ({count('Boat')})
        </button>
      </div>
      {feedback && (
        <p className="notice" role="status">
          {feedback}
        </p>
      )}
      <div className="ops-filters">
        <label>
          Search packages
          <input
            type="search"
            placeholder="ID, customer, phone, address or driver"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Status
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="All">All packages</option>
            <option value="Active">Active deliveries</option>
            <option value="Unassigned">Needs assignment</option>
            <option value="Boat">Boat handovers</option>
            {[...new Set([...statuses, ...packages.map((p) => p.status)])].map(
              (status) => (
                <option key={status}>{status}</option>
              )
            )}
          </select>
        </label>
        <label>
          Destination
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="All">All destinations</option>
            {[...new Set(packages.map((p) => p.area))].map((destination) => (
              <option key={destination}>{destination}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => selectSummary('All')}
        >
          Reset filters
        </button>
      </div>
      <p className="ops-count" aria-live="polite">
        {filtered.length} of {packages.length} packages
      </p>
      <div className="ops-queue">
        {!filtered.length && (
          <p className="empty">No packages match these filters.</p>
        )}
        {filtered.map((p) => {
          const draft = drafts[p.id] || {
            driver: p.driver || '',
            status: p.status,
            failureReason: p.failureReason || '',
          };
          return (
            <details className="ops-package" key={p.id}>
              <summary>
                <div>
                  <strong>{p.id}</strong>
                  <span>{p.customer}</span>
                  <span className="ops-package-registered">Registered · {formatPackageAddedAt(p.createdAt || p.created_at)}</span>
                </div>
                <div className="ops-destination">
                  <strong>{p.area}</strong>
                  <span>
                    {p.area === 'Boat'
                      ? p.boatName || p.address || 'Boat name not recorded'
                      : p.address || 'Address not recorded'}
                  </span>
                </div>
                <div>
                  <span className={p.driver ? 'ops-driver' : 'ops-unassigned'}>
                    {p.driver ||
                      (active(p) ? 'Needs assignment' : 'Driver not recorded')}
                  </span>
                  <span className={`status status-${statusClass(p.status)}`}>
                    {p.status}
                  </span>
                </div>
                <span className="ops-manage">
                  Manage <span aria-hidden="true">⌄</span>
                </span>
              </summary>
              <div className="ops-package-body">
                <dl className="ops-delivery-details">
                  <div>
                    <dt>Customer phone</dt>
                    <dd>
                      <a href={`tel:${p.phone}`}>{p.phone}</a>
                    </dd>
                  </div>
                  <div>
                    <dt>Partner</dt>
                    <dd>{p.partnerName || 'Not recorded'}</dd>
                  </div>
                  {p.area === 'Boat' && (
                    <>
                      <div>
                        <dt>Boat location</dt>
                        <dd>{p.boatLocation || 'Not provided'}</dd>
                      </div>
                      <div>
                        <dt>Departure time</dt>
                        <dd>{p.departureTime || 'Not provided'}</dd>
                      </div>
                    </>
                  )}
                  {p.landmark && (
                    <div>
                      <dt>Landmark</dt>
                      <dd>{p.landmark}</dd>
                    </div>
                  )}
                  {p.item && (
                    <div>
                      <dt>Package</dt>
                      <dd>{p.item}</dd>
                    </div>
                  )}
                  {p.notes && (
                    <div>
                      <dt>Delivery instructions</dt>
                      <dd>{p.notes}</dd>
                    </div>
                  )}
                  {p.area === 'Boat' && (p.handoverPhoto || p.proofOfDeliveryPath) && (
                    <div className="ops-photo-detail">
                      <dt>Proof of delivery</dt>
                      <dd>
                        {p.proofOfDeliveryPath ? <PackageProofLink path={p.proofOfDeliveryPath} /> : <img src={p.handoverPhoto} alt={`Boat delivery proof for ${p.id}`} />}
                      </dd>
                    </div>
                  )}
                  {p.failureReason && (
                    <div>
                      <dt>Failed delivery reason</dt>
                      <dd>{p.failureReason}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Delivery fee</dt>
                    <dd>MVR {p.fee}</dd>
                  </div>
                </dl>
                <form
                  className="ops-assignment"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onUpdate(p.id, {
                      driver: draft.driver.trim(),
                      status: draft.status,
                      failureReason:
                        draft.status === 'Failed Delivery'
                          ? draft.failureReason.trim()
                          : '',
                      handoverPhoto:
                        p.area === 'Boat' && draft.status === 'Delivered'
                          ? draft.handoverPhoto
                          : p.handoverPhoto || '',
                    });
                    setDrafts((current) => {
                      const next = { ...current };
                      delete next[p.id];
                      return next;
                    });
                    setFeedback(p.id + ' updated.');
                  }}
                >
                  <label>
                    Driver name <div className="ops-driver-picker"><input autoComplete="off" value={draft.driver} onFocus={() => setActiveDriverField(p.id)} onChange={(e) => { change(p, 'driver', e.target.value); setActiveDriverField(p.id); }} required={['Picked Up', 'Out for Delivery'].includes(draft.status)} placeholder={driverNames.length ? 'Type to search drivers' : 'No drivers found'} aria-label={`Driver for ${p.id}`} />{activeDriverField === p.id && <div className="ops-driver-suggestions" role="listbox">{driverNames.filter((name) => name.toLowerCase().includes((draft.driver || '').trim().toLowerCase())).map((name) => <button key={name} type="button" className="secondary-btn" role="option" aria-selected={draft.driver === name} onMouseDown={(e) => e.preventDefault()} onClick={() => { change(p, 'driver', name); setActiveDriverField(''); }}>{name}</button>)}{!driverNames.some((name) => name.toLowerCase().includes((draft.driver || '').trim().toLowerCase())) && <span>No matching drivers</span>}</div>}</div>
                  </label>
                  <label>
                    Delivery status
                    <select
                      value={draft.status}
                      onChange={(e) => change(p, 'status', e.target.value)}
                      aria-label={`Status for ${p.id}`}
                    >
                      {[...new Set([...statuses, p.status])].map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                    </select>
                  </label>
                  {p.area === 'Boat' && draft.status === 'Delivered' && (
                    <label className="ops-photo-upload">
                      Boat handover photo *
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        required={!draft.handoverPhoto}
                        onChange={(e) => selectPhoto(p, e.target.files?.[0])}
                        aria-label={`Boat handover photo for ${p.id}`}
                      />
                      <small>
                        Take or choose a clear photo showing the package handed
                        over at the boat.
                      </small>
                      {draft.handoverPhoto && (
                        <img
                          src={draft.handoverPhoto}
                          alt="Boat handover preview"
                        />
                      )}
                    </label>
                  )}
                  {draft.status === 'Failed Delivery' && (
                    <label className="ops-failure">
                      Reason for failed delivery *
                      <input
                        required
                        pattern=".*\S.*"
                        value={draft.failureReason}
                        onChange={(e) =>
                          change(p, 'failureReason', e.target.value)
                        }
                        placeholder="e.g. Customer unavailable"
                        aria-label={`Failure reason for ${p.id}`}
                      />
                    </label>
                  )}
                  <button type="submit" className="primary-btn">
                    Save {p.id}
                  </button>
                </form>
              </div>
            </details>
          );
        })}
      </div>
      <p className="ops-footnote">
        {liveMode ? 'Assignments and delivery updates are saved to the database.' : 'Tracking and invoice balances are demo-only.'}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  onClick,
  scrollTarget = 'dispatch-queue-heading',
}) {
  const content = (
    <>
      <span className="stat-label">{label}</span>
      <strong
        className={
          typeof value === 'string' && !value.startsWith('MVR')
            ? 'stat-text-value'
            : ''
        }
      >
        {value}
      </strong>
      {detail && <small>{detail}</small>}
      {onClick && (
        <span className="stat-link">
          View details <span aria-hidden="true">→</span>
        </span>
      )}
    </>
  );
  return onClick ? (
    <button
      type="button"
      className="stat-card stat-action"
      onClick={(event) => {
        onClick(event);
        if (onClick) {
          if (scrollTarget) {
            window.setTimeout(() => {
              document.getElementById(scrollTarget)?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              });
            }, 100);
          }
        }
      }}
    >
      {content}
    </button>
  ) : (
    <div className="stat-card">{content}</div>
  );
}
function PackageTable({ packages }) {
  return (
    <div className="table-wrap">
      <table className="package-desktop-table">
        <thead>
          <tr>
            <th>Package ID</th>
            <th>Added</th>
            <th>Customer</th>
            <th>Partner</th>
            <th>Phone</th>
            <th>Area</th>
            <th>Fee</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((p) => (
            <tr key={p.id}>
              <td>
                <strong>{p.id}</strong>
              </td>
              <td><time dateTime={p.createdAt || p.created_at || undefined}>{formatPackageAddedAt(p.createdAt || p.created_at)}</time></td>
              <td>{p.customer}</td>
              <td>{p.partnerName || p.partner || 'Partner not linked'}</td>
              <td>{p.phone}</td>
              <td>{p.area}</td>
              <td>MVR {p.fee}</td>
              <td>
                <span className={`status status-${statusClass(p.status)}`}>
                  {p.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {packages.length > 0 && (
        <ul
          className="package-mobile-list"
          aria-label="Packages, newest first"
          tabIndex={0}
        >
          {packages.map((p) => (
            <li className="package-mobile-row" key={p.id}>
              <div className="package-mobile-heading">
                <strong>{p.id}</strong>
                <span className={`status status-${statusClass(p.status)}`}>
                  {p.status}
                </span>
              </div>
              <div className="package-mobile-contact">
                <span>Added · {formatPackageAddedAt(p.createdAt || p.created_at)}</span>
              </div>
              <div className="package-mobile-details">
                <strong>{p.customer}</strong>
                <span>MVR {p.fee}</span>
              </div>
              <div className="package-mobile-contact">
                <span>Partner · {p.partnerName || p.partner || 'Partner not linked'}</span>
              </div>
              <div className="package-mobile-contact">
                <a href={`tel:${p.phone}`}>{p.phone}</a>
                <span>{p.area}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {packages.length === 0 && <p className="empty">No packages found.</p>}
    </div>
  );
}

function PackageProofLink({ path, label = 'View proof of delivery' }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    let active = true;
    getPrivateFileUrl(path).then((signed) => active && setUrl(signed)).catch((loadError) => active && setError(loadError.message || 'Could not load proof image.'));
    return () => { active = false; };
  }, [path]);
  const openLatestFile = async (event) => {
    event.preventDefault();
    setOpening(true);
    setError('');
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      setError('Your browser blocked the receipt window. Allow pop-ups for this site and try again.');
      setOpening(false);
      return;
    }
    try {
      const signed = await getPrivateFileUrl(path);
      setUrl(signed);
      popup.location.href = signed;
    } catch (loadError) {
      popup.close();
      setError(loadError.message || 'Could not open this file. Try again.');
    } finally {
      setOpening(false);
    }
  };
  if (!url) return <small>{error || 'Loading file…'}</small>;
  return <><a href={url} target="_blank" rel="noreferrer" onClick={openLatestFile}>{opening ? 'Opening…' : label}</a>{error && <small role="alert"> {error}</small>}</>;
}

function PaymentSlipLink({ path, name }) {
  if (!path) return <span>{name || 'No receipt attached'}</span>;
  return <PackageProofLink path={path} label="View payment slip" />;
}

function AdminDriverRoster({ packages, liveMode = false }) {
  const names = [
    ...new Set([
      'Ahmed Rasheed',
      ...packages.map((p) => p.driver).filter(Boolean),
    ]),
  ];
  const readJson = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      return {};
    }
  };
  const [presence, setPresence] = useState(() =>
    readJson('igo-driver-presence-v1')
  );
  const [rates, setRates] = useState(() =>
    readJson('igo-driver-share-percent-v1')
  );
  const [liveDrivers, setLiveDrivers] = useState([]);
  const [rosterError, setRosterError] = useState('');
  const refreshRoster = async () => {
    if (!liveMode) return;
    try {
      const rows = await loadDriverRoster();
      setLiveDrivers(rows);
      setRosterError('');
    } catch (error) {
      setRosterError(error.message || 'Could not load drivers.');
    }
  };
  useEffect(() => {
    if (liveMode) {
      void refreshRoster();
      const timer = window.setInterval(() => void refreshRoster(), 30000);
      return () => window.clearInterval(timer);
    }
    const sync = () => {
      setPresence(readJson('igo-driver-presence-v1'));
      setRates(readJson('igo-driver-share-percent-v1'));
    };
    window.addEventListener('igo-driver-presence', sync);
    window.addEventListener('igo-driver-rate', sync);
    return () => {
      window.removeEventListener('igo-driver-presence', sync);
      window.removeEventListener('igo-driver-rate', sync);
    };
  }, [liveMode]);
  const liveNames = liveDrivers.map((driver) => driver.name);
  const displayNames = liveMode ? liveNames : names;
  const updateRate = async (name, value) => {
    const next = {
      ...rates,
      [name]: Math.min(100, Math.max(0, Number(value) || 0)),
    };
    setRates(next);
    if (liveMode) {
      const driver = liveDrivers.find((item) => item.name === name);
      if (!driver) return;
      try {
        await adminUpdateDriverSettings(driver.user_id, { share_percent: next[name] });
        await refreshRoster();
      } catch (error) {
        setRosterError(error.message || 'Could not save the driver share.');
      }
      return;
    }
    localStorage.setItem('igo-driver-share-percent-v1', JSON.stringify(next));
    window.dispatchEvent(new Event('igo-driver-rate'));
  };
  const online = (name) => liveMode
    ? liveDrivers.find((driver) => driver.name === name)?.online
    : presence[name]?.online;
  const shareRate = (name) => liveMode
    ? liveDrivers.find((driver) => driver.name === name)?.sharePercent ?? 0
    : rates[name] ?? 0;
  const onlineCount = displayNames.filter(online).length;
  return (
    <section className="driver-section">
      <div className="driver-section-heading">
        <div>
          <p className="driver-kicker">TEAM</p>
          <h3>Drivers</h3>
        </div>
        <span>{onlineCount} online</span>
        {liveMode && <button type="button" className="secondary-btn" onClick={refreshRoster}>Refresh</button>}
      </div>
      {rosterError && <p role="alert" className="notice">{rosterError}</p>}
      <div className="driver-delivery-list">
        {displayNames.map((name) => (
          <article
            className="driver-delivery-card"
            key={name}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <strong>{name}</strong>
              <div>{online(name) ? '🟢 Online' : 'Offline'}</div>
            </div>
            <label>
              Driver share (% of fee)
              <input
                aria-label={'Driver share percentage for ' + name}
                type="number"
                min="0"
                max="100"
                value={shareRate(name)}
                onChange={(e) => updateRate(name, e.target.value)}
              />
            </label>
          </article>
        ))}
      </div>
    </section>
  );
}

function DriverWorkflowDashboard({
  packages,
  onUpdate,
  driverName = 'Ahmed Rasheed',
  liveMode = false,
}) {
  const [online, setOnline] = useState(() => {
    try {
      return !!JSON.parse(
        localStorage.getItem('igo-driver-presence-v1') || '{}'
      )[driverName]?.online;
    } catch {
      return false;
    }
  });
  const [selected, setSelected] = useState([]);
  const [activePartner, setActivePartner] = useState(''); const [routeTab, setRouteTab] = useState('pickup'); const [deferredPickupIds, setDeferredPickupIds] = useState([]);
  const [proofs, setProofs] = useState({});
  const [reasons, setReasons] = useState({});
  const [rate, setRate] = useState(() => {
    try {
      return Number(
        JSON.parse(localStorage.getItem('igo-driver-share-percent-v1') || '{}')[
          driverName
        ] || 0
      );
    } catch {
      return 0;
    }
  });
  const [withdrawalRequests, setWithdrawalRequests] = useState(() =>
    readDriverWithdrawalRequests().filter((request) => request.driver === driverName)
  );
  const [liveDriverSettings, setLiveDriverSettings] = useState(null);
  const [workflowError, setWorkflowError] = useState('');
  useEffect(() => {
    if (liveMode) {
      let active = true;
      Promise.all([loadDriverSettings(), loadWithdrawalRequests()]).then(([settings, requests]) => {
        if (!active) return;
        setLiveDriverSettings(settings);
        setOnline(Boolean(settings.online));
        setRate(Number(settings.share_percent || 0));
        setWithdrawalRequests(requests);
      }).catch((error) => active && setWorkflowError(error.message || 'Could not load driver details.'));
      return () => { active = false; };
    }
    const sync = () =>
      setWithdrawalRequests(
        readDriverWithdrawalRequests().filter((request) => request.driver === driverName)
      );
    window.addEventListener('igo-driver-withdrawals-updated', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('igo-driver-withdrawals-updated', sync);
      window.removeEventListener('storage', sync);
    };
  }, [driverName, liveMode]);
  const assigned = packages.filter((p) => p.driver === driverName);
  const waiting = packages.filter(
    (p) => !p.driver && !['Delivered', 'Cancelled'].includes(p.status)
  );
  const partnerGroups = [...waiting.reduce((groups, p) => {
    const name = p.partnerName || p.partner || 'Unknown partner';
    const id = String(p.partnerId || name);
    const group = groups.get(id) || { id, name, logoUrl: p.partnerLogo || '', packages: [] };
    if (!group.logoUrl && p.partnerLogo) group.logoUrl = p.partnerLogo;
    group.packages.push(p);
    groups.set(id, group);
    return groups;
  }, new Map()).values()];
  const visibleWaiting = activePartner
    ? waiting.filter((p) => String(p.partnerId || p.partnerName || p.partner || 'Unknown partner') === activePartner)
    : [];
  const active = assigned.filter(
    (p) => !['Delivered', 'Cancelled'].includes(p.status)
  );
  const delivered = assigned.filter((p) => p.status === 'Delivered'); const pendingPickups = active.filter((p) => p.status === 'Pending' && !deferredPickupIds.includes(p.id)); const inDelivery = active.filter((p) => p.status !== 'Pending'); const deferredPending = active.filter((p) => p.status === 'Pending' && deferredPickupIds.includes(p.id)); useEffect(() => { if (routeTab === 'pickup' && pendingPickups.length === 0 && inDelivery.length > 0) setRouteTab('delivery'); }, [routeTab, pendingPickups.length, inDelivery.length]); const routePackages = routeTab === 'delivered' ? delivered : routeTab === 'delivery' ? inDelivery : pendingPickups;
  const earned = delivered.reduce(
    (total, p) => total + ((Number(p.fee) || 0) * rate) / 100,
    0
  );
  const reservedWithdrawal = withdrawalRequests
    .filter((request) => ['pending', 'approved', 'paid'].includes(request.status))
    .reduce((total, request) => total + Number(request.amount || 0), 0);
  const withdrawable = Math.max(0, earned - reservedWithdrawal);
  const bankDetails = liveMode
    ? { bankName: liveDriverSettings?.bank_name, accountHolder: liveDriverSettings?.account_holder, accountNumber: liveDriverSettings?.account_number, branch: liveDriverSettings?.branch }
    : readDriverBankDetails(driverName);
  const hasBankDetails = Boolean(
    bankDetails.bankName && bankDetails.accountHolder && bankDetails.accountNumber
  );
  const madeRequestToday = withdrawalRequests.some(
    (request) => localDateKey(request.requestedAt) === localDateKey(new Date())
  );
  const requestWithdrawal = async () => {
    if (withdrawable <= 0 || !hasBankDetails || madeRequestToday) return;
    if (liveMode) {
      try {
        await requestDatabaseWithdrawal(Number(withdrawable.toFixed(2)), bankDetails);
        setWithdrawalRequests(await loadWithdrawalRequests());
        setWorkflowError('');
      } catch (error) {
        setWorkflowError(error.message || 'Could not submit withdrawal request.');
      }
      return;
    }
    const request = {
      id: 'WD-' + Date.now(),
      driver: driverName,
      amount: Number(withdrawable.toFixed(2)),
      status: 'pending',
      bankDetails: { ...bankDetails },
      requestedAt: new Date().toISOString(),
    };
    const next = [...readDriverWithdrawalRequests(), request];
    saveDriverWithdrawalRequests(next);
    setWithdrawalRequests(next.filter((entry) => entry.driver === driverName));
  };
  const changeOnline = async () => {
    const next = !online;
    setOnline(next);
    if (liveMode) {
      try {
        const saved = await saveDriverSettings({ online: next, online_updated_at: new Date().toISOString() });
        setLiveDriverSettings(saved);
        setWorkflowError('');
      } catch (error) {
        setOnline(!next);
        setWorkflowError(error.message || 'Could not update online status.');
      }
      return;
    }
    try {
      const presence = JSON.parse(
        localStorage.getItem('igo-driver-presence-v1') || '{}'
      );
      presence[driverName] = {
        online: next,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem('igo-driver-presence-v1', JSON.stringify(presence));
      window.dispatchEvent(new Event('igo-driver-presence'));
    } catch {}
  };
  useEffect(() => {
    if (liveMode) return undefined;
    const sync = () => {
      try {
        setRate(
          Number(
            JSON.parse(
              localStorage.getItem('igo-driver-share-percent-v1') || '{}'
            )[driverName] || 0
          )
        );
      } catch {
        setRate(0);
      }
    };
    window.addEventListener('igo-driver-rate', sync);
    return () => window.removeEventListener('igo-driver-rate', sync);
  }, [liveMode]);
  const scrollToTask = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const handleMetricKeyDown = (event, id) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      scrollToTask(id);
    }
  };
  const acceptSelected = () => {
    selected.forEach((id) => onUpdate(id, { driver: driverName }));
    setSelected([]);
  };
  const mapLink = (address) =>
    'https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent(address);
  const recordFailed = (p) => {
    if (!reasons[p.id]) return;
    onUpdate(p.id, {
      status: 'Failed Delivery',
      failureReason: reasons[p.id],
      returnedToGodown: false,
    });
  };
  const confirmBoatDelivery = (p) => {
    if (!proofs[p.id]) return;
    onUpdate(p.id, { status: 'Delivered', proofPhoto: proofs[p.id] });
  };
  return (
    <div className="driver-dashboard">
      <div className="driver-banner">
        <div>
          <p className="driver-kicker">DRIVER WORKSPACE</p>
          <h2>Good day, {driverName.split(' ')[0]}</h2>
          <p>
            {online
              ? 'Available for delivery jobs.'
              : 'Go online to see and accept jobs.'}
          </p>
        </div>
        <button
          type="button"
          className={`driver-availability-switch ${online ? 'is-online' : 'is-offline'}`}
          onClick={changeOnline}
          role="switch"
          aria-checked={online}
          aria-label={online ? 'Online, switch to go offline' : 'Offline, switch to go online'}
        >
          <span className="driver-availability-label">{online ? 'Online' : 'Offline'}</span>
          <span className="driver-switch-track" aria-hidden="true">
            <span className="driver-switch-thumb" />
          </span>
        </button>
      </div>
      <div className="driver-metrics">
        <article role="button" tabIndex={0} onClick={() => scrollToTask('driver-new-jobs')} onKeyDown={(event) => handleMetricKeyDown(event, 'driver-new-jobs')}>
          <span>New packages</span>
          <strong>{waiting.length}</strong>
          <small>Waiting for a driver</small>
        </article>
        <article role="button" tabIndex={0} onClick={() => scrollToTask('driver-my-route')} onKeyDown={(event) => handleMetricKeyDown(event, 'driver-my-route')}>
          <span>Assigned to me</span>
          <strong>{assigned.length}</strong>
          <small>My packages</small>
        </article>
        <article role="button" tabIndex={0} onClick={() => scrollToTask('driver-my-route')} onKeyDown={(event) => handleMetricKeyDown(event, 'driver-my-route')}>
          <span>To complete</span>
          <strong>{active.length}</strong>
          <small>Open tasks</small>
        </article>
        <article role="button" tabIndex={0} onClick={() => scrollToTask('driver-earnings')} onKeyDown={(event) => handleMetricKeyDown(event, 'driver-earnings')}>
          <span>Earned</span>
          <strong>MVR {earned.toFixed(2)}</strong>
          <small>Driver share · {rate}% of each delivery fee</small>
        </article>
      </div>
      <section id="driver-new-jobs" className="driver-section">
        <div className="driver-section-heading">
          <div>
            <p className="driver-kicker">NEW JOBS</p>
            <h3>
              Available packages{' '}
              <span
                className="driver-notification-badge"
                aria-label={waiting.length + ' packages waiting'}
              >
                {waiting.length}
              </span>
            </h3>
          </div>
          <span className="driver-count">{waiting.length} waiting</span>
        </div>
        {!online && (
          <p className="notice">Go online to accept delivery jobs.</p>
        )}
        {waiting.length ? (
          <>
            <div className="driver-partner-grid" aria-label="New jobs by partner">
              {partnerGroups.map((group) => (
                <button
                  type="button"
                  key={group.id}
                  className={'driver-partner-tile' + (activePartner === group.id ? ' is-selected' : '')}
                  onClick={() => {
                    setActivePartner(activePartner === group.id ? '' : group.id);
                    setSelected([]);
                  }}
                  aria-pressed={activePartner === group.id}
                >
                  {group.logoUrl && <img className="driver-partner-logo" src={group.logoUrl} alt="" loading="lazy" />}
                  <span className="driver-partner-tile-name">{group.name}</span>
                  <span className="driver-partner-count" aria-label={group.packages.length + ' packages'}>{group.packages.length}</span>
                </button>
              ))}
            </div>
            <p className="driver-partner-filter-label">
              {activePartner ? 'Showing ' + (partnerGroups.find((group) => group.id === activePartner)?.name || 'partner') + ' jobs' : 'Select a partner to view available packages'}
            </p>
            <label className="driver-select-all">
              <input
                type="checkbox"
                checked={visibleWaiting.length > 0 && visibleWaiting.every((p) => selected.includes(p.id))}
                onChange={(e) =>
                  setSelected((current) =>
                    e.target.checked
                      ? [...new Set([...current, ...visibleWaiting.map((p) => p.id)])]
                      : current.filter((id) => !visibleWaiting.some((p) => p.id === id))
                  )
                }
              />
              <span>Select all packages</span>
            </label>
            <div className="driver-delivery-list">
            {visibleWaiting.map((p) => (
                <label
                  className="driver-delivery-card"
                  key={p.id}
                  style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}
                >
                  <input
                    type="checkbox"
                    disabled={!online}
                    checked={selected.includes(p.id)}
                    onChange={(e) =>
                      setSelected((current) =>
                        e.target.checked
                          ? [...current, p.id]
                          : current.filter((id) => id !== p.id)
                      )
                    }
                  />
                  <span>
                    <strong>
                      {p.id} · {p.customer}
                    </strong>
                    <br />
                    {p.area || 'Destination not recorded'} · MVR {p.fee}
                  </span>
                </label>
              ))}
            </div>
            <button
              type="button"
              className="driver-action"
              disabled={!online || !selected.length}
              onClick={acceptSelected}
            >
              Accept {selected.length || ''} selected package
              {selected.length === 1 ? '' : 's'}
            </button>
          </>
        ) : (
          <p>No new packages right now.</p>
        )}
      </section>
      <section id="driver-my-route" className="driver-section">
        <div className="driver-section-heading">
          <div>
            <p className="driver-kicker">MY ROUTE</p>
            <h3>Assigned packages</h3>
          </div>
          <span className="driver-count">{active.length} active</span>
        </div>
        <div role="tablist" aria-label="Package trip stages" style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}><button type="button" role="tab" aria-selected={routeTab === 'pickup'} className="secondary-btn" onClick={() => setRouteTab('pickup')}>Pickups ({pendingPickups.length})</button><button type="button" role="tab" aria-selected={routeTab === 'delivery'} className="secondary-btn" onClick={() => setRouteTab('delivery')}>Deliveries ({inDelivery.length})</button><button type="button" role="tab" aria-selected={routeTab === 'delivered'} className="secondary-btn" onClick={() => setRouteTab('delivered')}>Delivered ({delivered.length})</button></div>{routeTab === 'delivery' && pendingPickups.length > 0 && <button type="button" className="secondary-btn" onClick={() => setRouteTab('pickup')}>Return to pickups ({pendingPickups.length})</button>}{routeTab === 'pickup' && inDelivery.length > 0 && <button type="button" className="driver-action" onClick={() => setRouteTab('delivery')}>Start delivery run ({inDelivery.length})</button>}{deferredPending.length > 0 && <button type="button" className="secondary-btn" onClick={() => setDeferredPickupIds([])}>Restore {deferredPending.length} skipped package(s)</button>}{routePackages.length ? (
          <div className="driver-delivery-list">
            {routePackages.map((p) => (
              <article className="driver-delivery-card" key={p.id}>
                <div className="driver-delivery-top">
                  <div>
                    <span className="driver-package-id">{p.id}</span>
                    <h4>{p.customer}</h4>
                  </div>
                  <span className={'status status-' + statusClass(p.status)}>
                    {p.status}
                  </span>
                </div>
                {p.status === 'Pending' ? <p style={{ margin: '0 0 14px', padding: '10px 12px', borderRadius: 10, background: '#fff7d6', color: '#664f00', fontWeight: 700 }}><strong>Next step:</strong> Go to {p.partnerName || p.partner || 'the partner'} to collect this package.</p> : ['Picked Up', 'Out for Delivery'].includes(p.status) ? <p style={{ margin: '0 0 14px', padding: '10px 12px', borderRadius: 10, background: '#eaf6ef', color: '#155b43', fontWeight: 700 }}><strong>Next step:</strong> Deliver to {p.area === 'Boat' ? p.boatName || p.address || 'the boat' : p.address || p.area || 'the customer address'}.</p> : null}<details className="driver-route-details"><summary>Partner &amp; delivery details</summary><div className="driver-delivery-details">
                  <section className="driver-stop-group" aria-label="Partner pickup">
                    <strong>Partner pickup</strong>
                    <span>{p.partnerName || p.partner || 'Partner'}{p.partnerPhone ? ' · ' + p.partnerPhone : ''}</span>
                    {p.partnerAddress && <span>{p.partnerAddress}</span>}
                    <div className="driver-stop-actions">
                      {p.partnerPhone && <a href={'tel:' + p.partnerPhone}>Call partner</a>}
                      {p.partnerAddress && (
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href={mapLink(p.partnerAddress)}
                        >
                          Navigate to pickup
                        </a>
                      )}
                    </div>
                  </section>
                  <section className="driver-stop-group" aria-label="Customer delivery">
                    <strong>Customer delivery</strong>
                    <span>{p.customer || 'Customer'}{p.phone ? ' · ' + p.phone : ''}</span>
                    <span>
                      {p.area === 'Boat'
                        ? p.boatName || p.address || 'Boat address not recorded'
                        : p.address || p.area || 'Customer address not recorded'}
                    </span>
                    <div className="driver-stop-actions">
                      {p.phone && <a href={'tel:' + p.phone}>Call customer</a>}
                      {(p.address || p.area || p.boatName) && (
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href={mapLink(p.address || p.boatName || p.area)}
                        >
                          Navigate to customer
                        </a>
                      )}
                    </div>
                  </section>
                </div></details>
                <div className="driver-delivery-footer">
                  <span>
                    Driver pay{' '}
                    <strong>
                      MVR {(((Number(p.fee) || 0) * rate) / 100).toFixed(2)}
                    </strong>{' '}
                    <small>
                      ({rate}% of MVR {p.fee})
                    </small>
                  </span>
                  {p.status === 'Pending' && (<><button type="button" className="driver-action" onClick={() => onUpdate(p.id, { status: 'Picked Up', pickedUpAt: new Date().toISOString() })}>Confirm package collected</button><button type="button" className="secondary-btn" onClick={() => setDeferredPickupIds((ids) => ids.includes(p.id) ? ids : [...ids, p.id])}>Leave for next trip</button></>)}
                  {p.status === 'Picked Up' && (
                    <button
                      type="button"
                      className="driver-action"
                      onClick={() =>
                        onUpdate(p.id, { status: 'Out for Delivery' })
                      }
                    >
                      Start delivery
                    </button>
                  )}
                  {p.status === 'Out for Delivery' &&
                    (p.area === 'Boat' ? (
                      <div>
                        <label>
                          Proof of delivery image
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file && file.type.startsWith('image/')) {
                                const reader = new FileReader();
                                reader.onload = () =>
                                  setProofs((v) => ({
                                    ...v,
                                    [p.id]: reader.result,
                                  }));
                                reader.readAsDataURL(file);
                              }
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="driver-action"
                          disabled={!proofs[p.id]}
                          onClick={() => confirmBoatDelivery(p)}
                        >
                          Deliver with proof
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="driver-action"
                        onClick={() =>
                          onUpdate(p.id, {
                            status: 'Delivered',
                            deliveredAt: new Date().toISOString(),
                          })
                        }
                      >
                        Mark delivered
                      </button>
                    ))}
                  {p.status === 'Failed Delivery' && (
                    <button
                      type="button"
                      className="driver-action"
                      onClick={() =>
                        onUpdate(p.id, {
                          status: 'Returned to Godown',
                          driverReturnConfirmed: true,
                        })
                      }
                    >
                      Confirm returned to godown
                    </button>
                  )}
                </div>
                {['Pending', 'Picked Up', 'Out for Delivery'].includes(
                  p.status
                ) && (
                  <details className="driver-failed-attempt">
                    <summary>Last option · record failed attempt</summary>
                    <label>
                      Reason
                      <select
                        value={reasons[p.id] || ''}
                        onChange={(e) =>
                          setReasons((v) => ({ ...v, [p.id]: e.target.value }))
                        }
                      >
                        <option value="">Choose reason</option>
                        <option value="Customer did not answer after calling">
                          Customer did not answer after calling
                        </option>
                        <option value="Boat departed before arrival">
                          Boat departed
                        </option>
                        <option value="Other">Other</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={!reasons[p.id]}
                      onClick={() => recordFailed(p)}
                    >
                      Record attempt
                    </button>
                  </details>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p>{routeTab === 'delivered' ? 'No delivered packages yet.' : routeTab === 'delivery' ? (pendingPickups.length || deferredPending.length ? 'No deliveries in this batch. Return to pickups when ready.' : 'No deliveries in progress.') : deferredPending.length ? 'No packages remain in this pickup run. Restore skipped packages to continue.' : 'No packages waiting for pickup.'}</p>
        )}
      </section>
      {inDelivery.length > 0 && <button type="button" className="driver-delivery-fab" aria-label={`Open deliveries, ${inDelivery.length} packages awaiting delivery`} title="Open pending deliveries" onClick={() => { setRouteTab('delivery'); document.getElementById('driver-my-route')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} style={{position:'fixed',right:16,bottom:82,zIndex:30,display:'flex',alignItems:'center',gap:9,padding:'10px 14px',border:'none',borderRadius:999,background:'#155b43',color:'#fff',boxShadow:'0 8px 24px rgba(0,0,0,.2)',fontWeight:700,cursor:'pointer'}}><span>Deliveries</span><span aria-hidden="true" style={{width:10,height:10,borderRadius:'50%',background:'#ef4444',boxShadow:'0 0 0 2px #155b43'}} /></button>}<section id="driver-earnings" className="driver-section">
        <div className="driver-section-heading">
          <div>
            <p className="driver-kicker">EARNINGS</p>
            <h3>Completed delivery earnings</h3>
          </div>
          <span className="driver-count">{delivered.length} delivered</span>
        </div>
        {delivered.length ? (
          <div className="driver-delivery-list">
            {delivered.map((p) => (
              <article className="driver-delivery-card" key={p.id}>
                <strong>{p.id} · {p.customer}</strong>
                <span>Delivery fee MVR {p.fee} · Driver share {rate}%</span>
                <strong>MVR {(((Number(p.fee) || 0) * rate) / 100).toFixed(2)}</strong>
              </article>
            ))}
          </div>
        ) : (
          <p>No completed deliveries yet.</p>
        )}
        <p>Total earned: <strong>MVR {earned.toFixed(2)}</strong></p>
        <div className="driver-withdrawal-request">
          <div>
            <strong>Available to withdraw: MVR {withdrawable.toFixed(2)}</strong>
            <p>
              {!hasBankDetails
                ? 'Add bank details in About before requesting.'
                : madeRequestToday
                ? 'One request per day. You can request again tomorrow.'
                : 'Finance or an admin must approve each request.'}
            </p>
          </div>
          <button
            type="button"
            className="driver-action"
            onClick={requestWithdrawal}
            disabled={withdrawable <= 0 || !hasBankDetails || madeRequestToday}
          >
            Request withdrawal
          </button>
        </div>
        {withdrawalRequests.length > 0 && (
          <div className="driver-withdrawal-history">
            <h4>Withdrawal requests</h4>
            {withdrawalRequests
              .slice()
              .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))
              .map((request) => (
                <p key={request.id}>
                  <span title={request.id}>{shortWithdrawalRequestId(request.id)}</span> · MVR {Number(request.amount).toFixed(2)} ·{' '}
                  <strong>{request.status}</strong>
                </p>
              ))}
          </div>
        )}
      </section>
      {workflowError && <p className="notice" role="alert">{workflowError}</p>}
      {!liveMode && <p className="driver-demo-note">Demo only. Status and presence are saved in this preview.</p>}
    </div>
  );
}

function DriverAbout({ driverName, liveMode = false }) {
  const [details, setDetails] = useState(() => readDriverBankDetails(driverName));
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    if (!liveMode) return undefined;
    let active = true;
    loadDriverSettings().then((row) => {
      if (active) setDetails({ bankName: row.bank_name || '', accountHolder: row.account_holder || '', accountNumber: row.account_number || '', branch: row.branch || '' });
    }).catch((error) => active && setSaveError(error.message || 'Could not load bank details.'));
    return () => { active = false; };
  }, [liveMode]);
  const update = (field, value) =>
    setDetails((current) => ({ ...current, [field]: value }));
  const submit = async (event) => {
    event.preventDefault();
    const clean = {
      bankName: String(details.bankName || '').trim(),
      accountHolder: String(details.accountHolder || '').trim(),
      accountNumber: String(details.accountNumber || '').trim(),
      branch: String(details.branch || '').trim(),
    };
    if (liveMode) {
      try {
        const row = await saveDriverSettings({ bank_name: clean.bankName, account_holder: clean.accountHolder, account_number: clean.accountNumber, branch: clean.branch });
        setDetails({ bankName: row.bank_name || '', accountHolder: row.account_holder || '', accountNumber: row.account_number || '', branch: row.branch || '' });
        setSaved(true); setSaveError('');
      } catch (error) { setSaveError(error.message || 'Could not save bank details.'); }
    } else {
      saveDriverBankDetails(driverName, clean);
      setDetails(clean);
      setSaved(true);
    }
  };
  return (
    <section className="driver-section driver-about">
      <p className="driver-kicker">DRIVER PROFILE</p>
      <h2>About</h2>
      <p>{driverName} · Bank details for approved withdrawals.</p>
      <form onSubmit={submit} className="driver-about-form">
        <label>Bank name<input required autoComplete="organization" value={details.bankName || ''} onChange={(event) => update('bankName', event.target.value)} /></label>
        <label>Account holder name<input required autoComplete="name" value={details.accountHolder || ''} onChange={(event) => update('accountHolder', event.target.value)} /></label>
        <label>Account number<input required autoComplete="off" inputMode="numeric" value={details.accountNumber || ''} onChange={(event) => update('accountNumber', event.target.value)} /></label>
        <label>Branch (optional)<input autoComplete="address-level2" value={details.branch || ''} onChange={(event) => update('branch', event.target.value)} /></label>
        <button type="submit" className="driver-action">Save bank details</button>
        {saved && <p role="status">Bank details saved {liveMode ? 'to your account.' : 'in this demo.'}</p>}
        {saveError && <p role="alert" className="notice">{saveError}</p>}
      </form>
      <p>These details are attached to withdrawal requests so finance can review the payment destination.</p>
    </section>
  );
}

function AccountsDashboard() {
  const accounts = [
    {
      name: 'Aminath Saeed',
      type: 'Partner',
      email: 'aminath@example.com',
      status: 'Pending',
    },
    {
      name: 'Ahmed Rasheed',
      type: 'Driver',
      email: 'ahmed@example.com',
      status: 'Pending',
    },
    {
      name: 'Ismail Nihad',
      type: 'Driver',
      email: 'ismail@example.com',
      status: 'Approved',
    },
    {
      name: 'Fathimath Shifa',
      type: 'Partner',
      email: 'fathimath@example.com',
      status: 'Rejected',
    },
    {
      name: 'Hassan Ali',
      type: 'Driver',
      email: 'hassan@example.com',
      status: 'Suspended',
    },
  ];
  const [filter, setFilter] = useState('All accounts');
  const visible =
    filter === 'All accounts'
      ? accounts
      : accounts.filter((account) => account.status === filter);
  return (
    <section className="accounts-dashboard" style={{ padding: 24 }}>
      <p className="approval-kicker">ADMIN WORKSPACE · DEMO</p>
      <h2>Accounts</h2>
      <p>Review account types and operational access status.</p>
      <div className="notice">
        Sample data only. This screen does not read or change live Supabase
        accounts.
      </div>
      <div
        style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '20px 0' }}
      >
        {['All accounts', 'Pending', 'Approved', 'Rejected', 'Suspended'].map(
          (status) => (
            <button
              key={status}
              className={
                filter === status ? 'primary-button' : 'secondary-button'
              }
              onClick={() => setFilter(status)}
            >
              {status}
            </button>
          )
        )}
      </div>
      <div className="accounts-list">
        {visible.map((account) => (
          <article
            key={account.email}
            className="application-card"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              alignItems: 'center',
              padding: 16,
              marginBottom: 10,
            }}
          >
            <div>
              <strong>{account.name}</strong>
              <div>{account.email}</div>
              <small>{account.type} account</small>
            </div>
            <span className="status-pill">{account.status}</span>
          </article>
        ))}
        {visible.length === 0 && <p>No accounts in this status.</p>}
      </div>
    </section>
  );
}

function SuperadminUserManagement() {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    const [{ data, error: loadError }, { data: emailRows, error: emailError }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, phone, role, created_at').order('created_at', { ascending: false }),
      supabase.rpc('list_igo_account_contact_emails'),
    ]);
    if (loadError) setError(loadError.message);
    else if (emailError) setError(emailError.message);
    else {
      const emailByUserId = new Map((emailRows || []).map((row) => [row.user_id, row.email || '']));
      setUsers((data || []).map((item) => ({ ...item, email: emailByUserId.get(item.id) || '' })));
    }
    setLoading(false);
  };

  const toggleUsers = async () => {
    if (!open) await loadUsers();
    setOpen(!open);
  };

  return (
    <section className="profile-user-management" style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid #e5e7eb' }}>
      <h3>User management</h3>
      <p>View registered admin, partner, and driver accounts.</p>
      <button type="button" className="secondary-btn" onClick={toggleUsers}>
        {open ? 'Hide users' : 'View users'}
      </button>
      {open && (
        <div style={{ marginTop: '1rem' }}>
          {loading && <p>Loading users…</p>}
          {error && <p role="alert">Could not load users: {error}</p>}
          {!loading && !error && users.length === 0 && <p>No user profiles found.</p>}
          {!loading && !error && users.map((item) => (
            <article key={item.id} style={{ padding: '0.85rem 0', borderBottom: '1px solid #e5e7eb' }}>
              <strong>{item.full_name || 'Name not provided'}</strong>
              <p style={{ margin: '0.3rem 0 0', color: '#64748b' }}>{item.role}</p>
              <p style={{ margin: '0.3rem 0 0', color: '#64748b', overflowWrap: 'anywhere' }}>Email: {item.email || 'Not provided'}</p>
              <p style={{ margin: '0.3rem 0 0', color: '#64748b' }}>Phone: {item.phone || 'Not provided'}</p>
              <small style={{ color: '#64748b' }}>Account ID: {item.id}</small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SuperadminUserManagementAccess() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let active = true;
    supabase.rpc('is_igo_superadmin').then(({ data }) => { if (active) setAllowed(data === true); });
    return () => { active = false; };
  }, []);
  return allowed ? <SuperadminUserManagementPanel /> : null;
}

function SuperadminUserManagementPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showInviteForm, setShowInviteForm] = useState(false);

  const inviteUser = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setMessage('');
    setError('');
    const { data, error: inviteError } = await supabase.functions.invoke('igo-invite-user', {
      body: {
        full_name: String(values.get('full_name') || '').trim(),
        email: String(values.get('email') || '').trim(),
        phone: String(values.get('phone') || '').trim(),
        role: String(values.get('role') || ''),
        business_name: String(values.get('business_name') || '').trim(),
        address: String(values.get('address') || '').trim(),
      },
    });
    if (inviteError) setError(inviteError.message);
    else {
      let inviterAuditMessage = '';
      if (String(values.get('role') || '') === 'admin') {
        const { error: auditError } = await supabase.rpc('record_igo_admin_inviter', {
          p_invited_email: String(data.email || values.get('email') || '').trim(),
        });
        inviterAuditMessage = auditError
          ? ' Inviter tracking could not be saved: ' + auditError.message
          : ' The admin invitation is recorded under the signed-in admin.';
      }
      setMessage('Invitation sent to ' + data.email + '. ' + (data.approval_status === 'pending' ? 'The account will need admin approval.' : 'The admin account is ready after the invite is accepted.') + inviterAuditMessage);
      form.reset();
      setShowInviteForm(false);
    }
    setBusy(false);
  };

  return (
    <section className="profile-user-management" style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>User management</h3>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => setShowInviteForm((visible) => !visible)}
          aria-expanded={showInviteForm}
          aria-controls="superadmin-invite-form"
        >{showInviteForm ? 'Close form' : 'Add user manually'}</button>
      </div>
      <p style={{ margin: '0.5rem 0 0', color: '#64748b' }}>
        Use manual invites mainly to create admin accounts or handle exceptions. Partners and riders should normally apply through the usual application process.
      </p>
      {showInviteForm && (
        <div style={{ marginTop: '0.75rem' }}>
          <p>Create an account and send an invitation. Partner and rider accounts still need admin approval.</p>
          <form id="superadmin-invite-form" onSubmit={inviteUser} style={{ display: 'grid', gap: '0.75rem', maxWidth: '36rem' }}>
            <label>Full name<input name="full_name" required /></label>
            <label>Email<input name="email" type="email" required /></label>
            <label>Phone *<input name="phone" type="tel" autoComplete="tel" required /></label>
            <label>Account type<select name="role" defaultValue="partner"><option value="partner">Partner</option><option value="driver">Driver</option><option value="admin">Admin</option></select></label>
            <label>Partner business name<input name="business_name" /></label>
            <label>Partner address<input name="address" /></label>
            <button type="submit" className="secondary-btn" disabled={busy}>{busy ? 'Sending invitation…' : 'Create account and invite'}</button>
          </form>
        </div>
      )}
      {message && <p role="status" className="notice">{message}</p>}
      {error && <p role="alert" className="notice">{error}</p>}
    </section>
  );
}

function PendingIgoUserApprovals() {
  const [pendingUsers, setPendingUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadPendingUsers = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase.rpc('list_pending_igo_user_approvals');
    if (loadError) setError(loadError.message);
    else setPendingUsers(data || []);
    if (showLoading) setLoading(false);
  };

  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refreshQuietly = async () => {
      if (!active || refreshing || document.visibilityState !== 'visible') return;
      refreshing = true;
      try { await loadPendingUsers(false); } finally { refreshing = false; }
    };
    void loadPendingUsers();
    const interval = window.setInterval(refreshQuietly, 15000);
    window.addEventListener('focus', refreshQuietly);
    document.addEventListener('visibilitychange', refreshQuietly);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshQuietly);
      document.removeEventListener('visibilitychange', refreshQuietly);
    };
  }, []);

  const reviewUser = async (user, decision) => {
    setBusyId(user.user_id);
    setError('');
    setMessage('');
    const { error: reviewError } = await supabase.rpc('review_pending_igo_user_approval', {
      p_user_id: user.user_id,
      p_decision: decision,
    });
    if (reviewError) setError(reviewError.message);
    else {
      setMessage((user.full_name || user.email) + ' was ' + decision + '.');
      await loadPendingUsers();
    }
    setBusyId('');
  };

  return (
    <section className="card" style={{ marginBottom: '1.25rem' }}>
      <div className="ops-heading">
        <div>
          <h2>Pending user approvals</h2>
          <p>{pendingUsers.length} partner or driver accounts waiting for review.</p>
        </div>
        <button type="button" className="secondary-btn" onClick={loadPendingUsers} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      {error && <p role="alert" className="notice">{error}</p>}
      {message && <p role="status" className="notice">{message}</p>}
      {!loading && pendingUsers.length === 0 && !error && <p>No users are waiting for approval.</p>}
      {pendingUsers.map((item) => (
        <article key={item.user_id} style={{ padding: '0.9rem 0', borderTop: '1px solid #e5e7eb' }}>
          <strong>{item.full_name || item.email}</strong>
          <p style={{ margin: '0.3rem 0', color: '#64748b' }}>{item.role} · {item.email} · Pending approval</p>
          <p style={{ margin: '0.3rem 0', color: '#64748b' }}>{item.phone || 'No phone number'}{item.account_name ? ' · ' + item.account_name : ''}{item.address ? ' · ' + item.address : ''}</p>
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.65rem' }}>
            <button type="button" className="primary-btn" onClick={() => reviewUser(item, 'approved')} disabled={busyId === item.user_id}>{busyId === item.user_id ? 'Saving…' : 'Approve'}</button>
            <button type="button" className="secondary-btn" onClick={() => reviewUser(item, 'rejected')} disabled={busyId === item.user_id}>Reject</button>
          </div>
        </article>
      ))}
    </section>
  );
}

function ProfileChangeRequests({ profile, user, workspace, setNotice }) {
  const [requests, setRequests] = useState([]);
  const [accountDetails, setAccountDetails] = useState(null);
  const [accountNames, setAccountNames] = useState({});
  const [field, setField] = useState('phone');
  const [requestedValue, setRequestedValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = profile?.role === 'admin';
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [adminProfiles, setAdminProfiles] = useState([]);

  const refreshRequests = async () => {
    if (!profile || !user) return;
    let query = supabase.from('profile_change_requests').select('*').order('requested_at', { ascending: false });
    if (!isAdmin) query = query.eq('user_id', user.id);
    const { data, error: requestError } = await query;
    if (requestError) { setError(requestError.message); return; }
    if (isAdmin) {
      const { data: elevated } = await supabase.rpc('is_igo_superadmin');
      const allowedSuperadmin = elevated === true;
      setIsSuperadmin(allowedSuperadmin);
      if (allowedSuperadmin) {
        const { data: admins } = await supabase.from('profiles').select('id,full_name,phone,role').eq('role', 'admin').order('full_name');
        setAdminProfiles(admins || []);
      }
    }
    const rows = data || [];
    setRequests(rows);
    if (isAdmin && rows.length) {
      const ids = [...new Set(rows.map((row) => row.user_id))];
      const { data: profiles } = await supabase.from('profiles').select('id,full_name,phone,role').in('id', ids);
      setAccountNames(Object.fromEntries((profiles || []).map((item) => [item.id, item])));
    }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      await refreshRequests();
      if (!active || !profile || !user) return;
      if (profile.role === 'partner') {
        const { data } = await supabase.from('partners').select('name,contact_name,phone,email,address').eq('owner_id', user.id).maybeSingle();
        if (active) setAccountDetails(data || null);
      } else if (profile.role === 'driver') {
        const { data } = await supabase.from('drivers').select('name,phone').eq('user_id', user.id).maybeSingle();
        if (active) setAccountDetails(data || null);
      }
    };
    load();
    return () => { active = false; };
  }, [profile?.id, user?.id, isAdmin]);

  const submitRequest = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    const { error: submitError } = await supabase.rpc('submit_profile_change_request', { p_field_name: field, p_requested_value: requestedValue.trim() });
    setBusy(false);
    if (submitError) { setError(submitError.message); return; }
    setRequestedValue('');
    setNotice('Change request sent to an admin for review.');
    await refreshRequests();
  };

  const reviewRequest = async (request, decision) => {
    setBusy(true); setError('');
    const { error: reviewError } = await supabase.rpc('review_profile_change_request', { p_request_id: request.id, p_decision: decision, p_note: null });
    setBusy(false);
    if (reviewError) { setError(reviewError.message); return; }
    setNotice(decision === 'approved' ? 'Profile change approved.' : 'Profile change rejected.');
    await refreshRequests();
  };

  const saveAdminProfile = async (event, profileId) => {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const { error: saveError } = await supabase.rpc('superadmin_update_admin_profile', { p_user_id: profileId, p_full_name: String(form.get('full_name') || '').trim(), p_phone: String(form.get('phone') || '').trim() });
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    setNotice('Admin profile updated by superadmin.');
    await refreshRequests();
  };

  const approvedEmailRequest = requests.find((request) => request.field_name === 'email' && request.status === 'approved' && request.requested_value.toLowerCase() !== (user?.email || '').toLowerCase());
  const confirmApprovedEmail = async () => {
    setBusy(true); setError('');
    const { error: emailError } = await supabase.auth.updateUser({ email: approvedEmailRequest.requested_value });
    setBusy(false);
    if (emailError) { setError(emailError.message); return; }
    setNotice('Email approved. Follow the verification link sent to the new address to finish the change.');
  };

  return <section className="profile-change-area">
    {!isAdmin && <>
      <h3>Registration details</h3>
      <dl className="profile-registration-details">
        <div><dt>Name</dt><dd>{profile?.full_name || accountDetails?.contact_name || accountDetails?.name || 'Not provided'}</dd></div>
        {profile?.role === 'partner' && <div><dt>Business</dt><dd>{accountDetails?.name || 'Not provided'}</dd></div>}
        <div><dt>Phone</dt><dd>{profile?.phone || accountDetails?.phone || 'Not provided'}</dd></div>
        <div><dt>Login email</dt><dd>{user?.email || 'Not provided'}</dd></div>
        {profile?.role === 'partner' && <div><dt>Business email</dt><dd>{accountDetails?.email || 'Not provided'}</dd></div>}
        {profile?.role === 'partner' && <div><dt>Registered address</dt><dd>{accountDetails?.address || 'Not provided'}</dd></div>}
      </dl>
      <h3>Request a change</h3>
      <p>Name changes can be approved once. Phone and email changes are reviewed by an admin before they take effect.</p>
      <form onSubmit={submitRequest} className="profile-change-form">
        <label>Detail<select value={field} onChange={(event) => setField(event.target.value)}><option value="phone">Phone number</option><option value="email">Login email</option></select></label>
        <label>New value<input required value={requestedValue} onChange={(event) => setRequestedValue(event.target.value)} type={field === 'email' ? 'email' : 'tel'} /></label>
        <button type="submit" className="secondary-btn" disabled={busy}>{busy ? 'Sending…' : 'Request change'}</button>
      </form>
      {approvedEmailRequest && <button type="button" className="secondary-btn" disabled={busy} onClick={confirmApprovedEmail}>Confirm approved email change</button>}
    </>}
    {isAdmin && <>
      <h3>Admin profile</h3><p>Admin profile details are read-only. Only a designated superadmin may change an admin account.</p>
      {isSuperadmin && <><h3>Admin profile management</h3>{adminProfiles.map((item) => <form className="profile-change-form" key={item.id} onSubmit={(event) => saveAdminProfile(event, item.id)}><strong>{item.full_name || item.id}</strong><label>Name<input name="full_name" defaultValue={item.full_name || ''} required /></label><label>Phone<input name="phone" defaultValue={item.phone || ''} /></label><button type="submit" className="secondary-btn" disabled={busy}>{busy ? 'Saving…' : 'Save admin profile'}</button></form>)}</>}
      
      
      <h3>Partner and driver change requests</h3>
    </>}
    {error && <p role="alert" className="notice">{error}</p>}
    <div className="profile-change-list">
      {requests.length === 0 ? <p>{isAdmin ? 'No profile change requests.' : 'No change requests yet.'}</p> : requests.map((request) => <article className="profile-change-row" key={request.id}>
        <div><strong>{isAdmin ? (accountNames[request.user_id]?.full_name || request.user_id) : request.field_name.replace('_', ' ')}</strong>{isAdmin && <span> · {accountNames[request.user_id]?.role || 'account'} · {request.field_name.replace('_', ' ')}</span>}
          <p>{request.current_value || 'Not provided'} → <strong>{request.requested_value}</strong></p>
          <span className={'status status-' + request.status}>{request.status} · {new Date(request.requested_at).toLocaleDateString()}</span>
        </div>
        {isAdmin && request.status === 'pending' && <div className="profile-change-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={() => reviewRequest(request, 'approved')}>Approve</button><button type="button" className="secondary-btn" disabled={busy} onClick={() => reviewRequest(request, 'rejected')}>Reject</button></div>}
      </article>)}
    </div>
  </section>;
}

function NotificationCenter({ onNavigate }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (!active || refreshing || document.visibilityState !== 'visible') return;
      refreshing = true;
      try {
        const rows = await loadNotifications();
        if (active) { setNotifications(rows); setError(''); }
      } catch (loadError) {
        if (active) setError(loadError.message || 'Could not load notifications.');
      } finally { refreshing = false; }
    };
    const refreshOnResume = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    const interval = window.setInterval(refresh, 10000);
    window.addEventListener('focus', refreshOnResume);
    document.addEventListener('visibilitychange', refreshOnResume);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshOnResume);
      document.removeEventListener('visibilitychange', refreshOnResume);
    };
  }, []);
  const markRead = async (id) => {
    try {
      await markNotificationRead(id);
      setNotifications((rows) => rows.map((row) => row.id === id ? { ...row, read: true } : row));
    } catch (markError) { setError(markError.message || 'Could not update notification.'); }
  };
  const handleNotificationClick = (item) => {
    void markRead(item.id);
    setOpen(false);
    onNavigate?.(item);
  };
  const unread = notifications.filter((item) => !item.read).length;
  return (
    <div className="notification-center" style={{ position: 'relative' }}>
      <button type="button" className="notification-icon-button" aria-label={"Notifications" + (unread > 0 ? ", " + unread + " unread" : "")} title="Notifications" onClick={() => setOpen((value) => !value)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
        {unread > 0 && <span className="notification-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && <section className="notification-panel" style={{ position: 'fixed', zIndex: 1000, right: 12, top: 'calc(env(safe-area-inset-top, 0px) + 68px)', width: 'min(360px, calc(100vw - 24px))', maxHeight: 'min(70vh, 420px)', overflowY: 'auto', background: localStorage.getItem('igo-theme') === 'night' ? '#1e293b' : '#fff', color: localStorage.getItem('igo-theme') === 'night' ? '#f3f4f6' : '#111827', border: `1px solid ${localStorage.getItem('igo-theme') === 'night' ? '#334155' : '#ddd'}`, borderRadius: 12, padding: 14, boxShadow: '0 8px 24px #0002' }}>
        <h3 style={{ marginTop: 0 }}>Notifications</h3>
        {error && <p role="alert">{error}</p>}
        {notifications.length ? notifications.map((item) => <article key={item.id} style={{ borderTop: '1px solid #eee', padding: '10px 0' }}>
          <button type="button" className="notification-item" onClick={() => handleNotificationClick(item)} style={{ display: 'block', width: '100%', background: 'transparent', border: 0, color: 'inherit', textAlign: 'left', font: 'inherit', padding: '6px 0', cursor: 'pointer' }}>
            <strong>{item.title}</strong><span style={{ display: 'block', margin: '4px 0' }}>{item.message}</span>
          <small>{new Date(item.created_at).toLocaleString()}</small>
          </button>
          {!item.read && <button type="button" className="secondary-btn" onClick={() => markRead(item.id)}>Mark read</button>}
        </article>) : <p>No notifications.</p>}
      </section>}
    </div>
  );
}

function FinanceManagement({ packages = [], workspace = 'Admin', liveMode = false, mode = 'management' }) {
  const [activeFinanceTab, setActiveFinanceTab] = useState('Invoices');
  const [overviewMonth, setOverviewMonth] = useState(() => {
    const now = new Date();
    return String(now.getFullYear()) + '-' + String(now.getMonth() + 1).padStart(2, '0');
  });
  const storageKey = 'igo-finance-workflow-demo-v1';
  const initialState = {
    cutoff: '18:00',
    nextInvoice: 105,
    invoices: [],
    payments: [],
    notifications: [],
    paidPayouts: {},
    expenses: [],
  };
  const readState = () => {
    try {
      return {
        ...initialState,
        ...JSON.parse(window.localStorage.getItem(storageKey) || '{}'),
      };
    } catch {
      return initialState;
    }
  };
  const [billing, setBilling] = useState(() => (liveMode ? initialState : readState()));
  const [readyPartnerSearch, setReadyPartnerSearch] = useState('');
  const [overviewDriverRates, setOverviewDriverRates] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('igo-driver-share-percent-v1') || '{}');
    } catch {
      return {};
    }
  });
  const [overviewDriverRatesReady, setOverviewDriverRatesReady] = useState(!liveMode);
  const [overviewDriverRatesError, setOverviewDriverRatesError] = useState('');
  useEffect(() => {
    let active = true;
    const syncDemoRates = () => {
      try {
        setOverviewDriverRates(JSON.parse(window.localStorage.getItem('igo-driver-share-percent-v1') || '{}'));
        setOverviewDriverRatesReady(true);
      } catch {
        setOverviewDriverRates({});
        setOverviewDriverRatesReady(false);
      }
    };
    if (!liveMode) {
      syncDemoRates();
      window.addEventListener('igo-driver-rate', syncDemoRates);
      window.addEventListener('storage', syncDemoRates);
      return () => {
        active = false;
        window.removeEventListener('igo-driver-rate', syncDemoRates);
        window.removeEventListener('storage', syncDemoRates);
      };
    }
    setOverviewDriverRatesReady(false);
    loadDriverRoster()
      .then((rows) => {
        if (!active) return;
        setOverviewDriverRates(Object.fromEntries(rows.map((driver) => [driver.name, Number(driver.sharePercent)])));
        setOverviewDriverRatesReady(true);
        setOverviewDriverRatesError('');
      })
      .catch((error) => {
        if (!active) return;
        setOverviewDriverRates({});
        setOverviewDriverRatesReady(false);
        setOverviewDriverRatesError(error.message || 'Driver share rates could not be loaded.');
      });
    return () => { active = false; };
  }, [liveMode]);
  const [databaseFinanceReady, setDatabaseFinanceReady] = useState(false);
  const [databaseFinanceError, setDatabaseFinanceError] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState(null);
  const [withdrawalRequests, setWithdrawalRequests] = useState(() =>
    liveMode ? [] : readDriverWithdrawalRequests()
  );
  const [paymentReviewDrafts, setPaymentReviewDrafts] = useState({});
  const [paymentReviewBusyId, setPaymentReviewBusyId] = useState('');
  const [paymentReviewFeedback, setPaymentReviewFeedback] = useState(null);
  const refreshDatabaseFinance = async (notifyRoot = false) => {
    if (!liveMode) return;
    try {
      if (workspace === 'Partner') setBilling((current) => ({ ...current, invoices: [], payments: [], partnerCredits: {} }));
      const partnerId = workspace === 'Partner' ? await getCurrentPartnerIdOptional() : undefined;
      const records = await loadFinanceRecords({ workspace, partnerId: partnerId || undefined });
      setBilling((current) => ({
        ...current,
        cutoff: records.invoiceCutoff || current.cutoff,
        invoices: records.invoices,
        payments: records.payments,
        partnerCredits: records.partnerCredits,
        expenses: records.expenses.map((row) => ({ id: row.id, date: row.expense_date, category: row.category, description: row.description, paidTo: row.paid_to, amount: Number(row.amount || 0), reference: row.reference || '', recordedAt: row.created_at })),
        transferAccountName: records.bankAccounts.find((row) => row.active)?.account_name || '',
        transferAccountNumber: records.bankAccounts.find((row) => row.active)?.account_number || '',
      }));
      setPaymentAccountId(records.bankAccounts.find((row) => row.active)?.id || null);
      setWithdrawalRequests(records.withdrawals);
      setDatabaseFinanceReady(true);
      setDatabaseFinanceError('');
      if (notifyRoot) window.dispatchEvent(new Event('igo-live-finance-updated'));
    } catch (error) {
      setBilling((current) => ({ ...current, invoices: [], payments: [], expenses: [] }));
      setPaymentAccountId(null);
      setWithdrawalRequests([]);
      setDatabaseFinanceReady(false);
      setDatabaseFinanceError(error.message || 'Could not load finance records.');
    }
  };
  useEffect(() => {
    if (liveMode) {
      void refreshDatabaseFinance();
      const sync = () => void refreshDatabaseFinance();
      window.addEventListener('igo-live-data-refreshed', sync);
      return () => window.removeEventListener('igo-live-data-refreshed', sync);
    }
    const sync = () => setWithdrawalRequests(readDriverWithdrawalRequests());
    window.addEventListener('igo-driver-withdrawals-updated', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('igo-driver-withdrawals-updated', sync);
      window.removeEventListener('storage', sync);
    };
  }, [liveMode, workspace]);
  const decideDriverWithdrawal = async (id, status) => {
    if (liveMode) {
      try {
        await reviewWithdrawal(id, status);
        await refreshDatabaseFinance(true);
        setNotice('Withdrawal request updated.');
      } catch (error) {
        setNotice(error.message || 'Could not update withdrawal request.');
      }
      return;
    }
    const next = readDriverWithdrawalRequests().map((request) =>
      request.id === id
        ? { ...request, status, reviewedAt: new Date().toISOString() }
        : request
    );
    saveDriverWithdrawalRequests(next);
    setWithdrawalRequests(next);
  };
  const [viewingInvoice, setViewingInvoice] = useState(null);
  const [selectedPaymentInvoiceId, setSelectedPaymentInvoiceId] = useState('');
  const [drafts, setDrafts] = useState({});
  const [notice, setNotice] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [expenseDraft, setExpenseDraft] = useState(() => ({
    date: localDateKey(new Date()),
    category: 'Fuel / petrol',
    description: '',
    paidTo: '',
    amount: '',
    reference: '',
  }));
  const [reportStart, setReportStart] = useState(() => {
    const now = new Date();
    return localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [reportEnd, setReportEnd] = useState(() => localDateKey(new Date()));
  const [reportPeriod, setReportPeriod] = useState(() => {
    const now = new Date();
    return {
      start: localDateKey(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: localDateKey(new Date()),
    };
  });
  const [reportGeneratedAt, setReportGeneratedAt] = useState(null);
  const [dailySalesDate, setDailySalesDate] = useState(() => localDateKey(new Date()));
  const [dailySalesGenerated, setDailySalesGenerated] = useState(null);
  const [adminUser, setAdminUser] = useState(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [liveInvoices, setLiveInvoices] = useState([]);
  const [liveError, setLiveError] = useState('');
  const [liveMessage, setLiveMessage] = useState('');
  const [liveBusy, setLiveBusy] = useState(false);
  const refreshLiveInvoices = async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('invoices')
      .select(
        'id,invoice_number,partner_id,period_start,period_end,subtotal,paid_amount,status,generated_at,partners(name),invoice_items(package_id,amount,packages(package_number,customer_name,area,item_description))'
      )
      .order('generated_at', { ascending: false });
    if (error) throw error;
    setLiveInvoices(data || []);
  };
  const verifyLiveAdmin = async (user) => {
    if (!supabase || !user) {
      setAdminUser(null);
      setLiveInvoices([]);
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (error || data?.role !== 'admin') {
      setAdminUser(null);
      setLiveInvoices([]);
      setLiveError(
        error?.message || 'This account does not have the iGO admin role.'
      );
      return;
    }
    setAdminUser(user);
    setLiveError('');
    try {
      await refreshLiveInvoices();
    } catch (loadError) {
      setLiveError(loadError.message || 'Could not load live invoices.');
    }
  };
  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setLiveError(error.message);
      else if (data.session) void verifyLiveAdmin(data.session.user);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session) {
        setAdminUser(null);
        setLiveInvoices([]);
        return;
      }
      window.setTimeout(() => {
        if (active) void verifyLiveAdmin(session.user);
      }, 0);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (liveMode) return;
    window.localStorage.setItem(storageKey, JSON.stringify(billing));
    window.dispatchEvent(new Event('igo-finance-updated'));
  }, [billing, liveMode]);
  const money = (value) => 'MVR ' + Number(value || 0).toLocaleString();
  const panel = {
    background: '#fff',
    border: '1px solid #e7e9e5',
    borderRadius: 14,
    padding: 18,
    marginTop: 18,
  };
  const buttonStyle = {
    border: 0,
    borderRadius: 8,
    padding: '9px 12px',
    background: '#174f39',
    color: '#fff',
    cursor: 'pointer',
  };
  const invoicedPackageIds = new Set(
    billing.invoices.flatMap((invoice) =>
      invoice.lines.map((line) => line.packageId)
    )
  );
  const deliveredPackages = packages.filter((p) => p.status === 'Delivered');
  const readyPackages = deliveredPackages.filter(
    (p) => !invoicedPackageIds.has(p.id)
  );
  const readyPartnerTotals = readyPackages.reduce((totals, packageItem) => {
    const partnerId = String(packageItem.partnerId || packageItem.partner?.id || '');
    const partnerName = String(
      packageItem.partnerName ||
      (typeof packageItem.partner === 'string' ? packageItem.partner : packageItem.partner?.name) ||
      (partnerId ? 'Partner ' + partnerId.slice(0, 8) : 'Partner not identified')
    ).trim();
    const key = partnerId || partnerName.toLocaleLowerCase();
    const total = totals.get(key) || { key, id: partnerId, name: partnerName, count: 0, amount: 0 };
    total.count += 1;
    total.amount += Number(packageItem.fee ?? packageItem.delivery_fee ?? 0);
    totals.set(key, total);
    return totals;
  }, new Map());
  const readyPartners = [...readyPartnerTotals.values()].sort((a, b) => a.name.localeCompare(b.name));
  const visibleReadyPartners = readyPartners.filter((partner) => partner.name.toLocaleLowerCase().includes(readyPartnerSearch.trim().toLocaleLowerCase()));
  const getPaid = (invoiceId) =>
    (liveMode
      ? Number(billing.invoices.find((invoice) => invoice.id === invoiceId)?.paidAmount || 0)
      : billing.payments
      .filter((p) => p.status === 'confirmed')
      .reduce((sum, p) => sum + Number(
        p.allocations?.find((allocation) => allocation.invoiceId === invoiceId)?.amount ||
        (p.invoiceId === invoiceId ? p.amount : 0)
      ), 0));
  const getInvoiceStatus = (invoice) => {
    const paid = getPaid(invoice.id);
    return paid >= invoice.amount
      ? 'Paid'
      : paid > 0
      ? 'Partially paid'
      : 'Pending payment';
  };
  const dailySalesRows = dailySalesGenerated
    ? (packages || [])
        .filter((delivery) => delivery.status === 'Delivered')
        .map((delivery) => {
          const invoice = (billing.invoices || []).find((item) =>
            item.lines?.some((line) => line.packageId === delivery.id)
          );
          const invoiceLine = invoice?.lines?.find(
            (line) => line.packageId === delivery.id
          );
          return {
            date: localDateKey(delivery.deliveredAt || invoice?.createdAt),
            invoice: invoice?.id || 'Not invoiced',
            partner: delivery.partnerName || delivery.partner || invoice?.partner || 'Style Hub',
            packageId: delivery.id,
            customer: delivery.customer || delivery.customer_name || invoiceLine?.customer || 'Customer',
            amount: Number(invoiceLine?.amount ?? delivery.fee ?? delivery.delivery_fee ?? 0),
            invoiceStatus: invoice ? getInvoiceStatus(invoice) : 'Not invoiced',
          };
        })
        .filter((row) => row.date === dailySalesGenerated.date)
    : [];
  const dailySalesTotal = dailySalesRows.reduce((sum, row) => sum + row.amount, 0);
  const addNotification = (current, title, message) =>
    [
      {
        id: Date.now() + Math.random(),
        title,
        message,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 20);
  const generateInvoices = async (partnerId = null, partnerName = null) => {
    const packagesToInvoice = readyPackages.filter((p) => {
      if (partnerId) return String(p.partnerId || p.partner_id || '') === String(partnerId);
      if (partnerName) return (p.partnerName || p.partner || 'Style Hub') === partnerName;
      return true;
    });
    if (!packagesToInvoice.length) {
      if (liveMode) {
        setLiveError('');
        setLiveMessage('No delivered, uninvoiced packages are ready to invoice.');
      } else {
        setNotice('There are no delivered, uninvoiced packages to bill.');
      }
      return;
    }
    if (liveMode) {
      if (!partnerId && partnerName) {
        setLiveError(`Could not identify ${partnerName}'s partner account. Refresh the page and try again.`);
        return;
      }
      await generateLiveInvoices(partnerId || null);
      return;
    }
    const grouped = packagesToInvoice.reduce((groups, p) => {
      const partner = p.partnerName || p.partner || 'Style Hub';
      (groups[partner] ||= []).push(p);
      return groups;
    }, {});
    const createdAt = new Date().toISOString();
    setBilling((current) => {
      let number = current.nextInvoice;
      const created = Object.entries(grouped).map(([partner, rows]) => {
        const lines = rows.map((p) => ({
          packageId: p.id,
          customer: p.customer || p.customer_name || 'Customer',
          area: p.area || '—',
          description: p.item || p.item_description || 'Delivery',
          amount: Number(p.fee ?? p.delivery_fee ?? 0),
        }));
        return {
          id: 'INV-' + number++,
          partner,
          period: new Date(createdAt).toLocaleDateString('en-MV', {
            month: 'short',
            year: 'numeric',
          }),
          createdAt,
          lines,
          amount: lines.reduce((sum, line) => sum + line.amount, 0),
        };
      });
      return {
        ...current,
        nextInvoice: number,
        invoices: [...created, ...current.invoices],
        notifications: addNotification(
          current.notifications,
          'Invoice ready for payment',
          created
            .map(
              (invoice) =>
                invoice.id +
                ' · ' +
                invoice.partner +
                ' · ' +
                money(invoice.amount)
            )
            .join('; ')
        ),
      };
    });
    setNotice(
      'Created ' +
        Object.keys(grouped).length +
        ' demo invoice(s) from delivered packages.'
    );
  };
  const submitPayment = async (event, invoices) => {
    event.preventDefault();
    setPaymentError('');
    const paymentForm = event.currentTarget;
    const payable = invoices.filter((invoice) => invoice.amount - getPaid(invoice.id) > 0);
    const dueTotal = payable.reduce((sum, invoice) => sum + Math.max(0, invoice.amount - getPaid(invoice.id)), 0);
    const paymentKey = 'all-outstanding-invoices';
    const draft = drafts[paymentKey] || {};
    const amount = Number(draft.amount ?? dueTotal);
    if (!draft.slipName || dueTotal <= 0 || !Number.isFinite(amount) || amount <= 0) {
      setPaymentError(dueTotal <= 0 ? 'There is no outstanding balance to pay.' : !draft.slipName ? 'Attach the payment slip before submitting.' : 'Enter the amount you transferred.');
      return;
    }
    const reference = (draft.reference || 'Payment for all outstanding invoices').trim();
    const invoiceIds = payable.map((invoice) => invoice.id);
    const invoiceLabels = payable.map((invoice) => invoice.id);
    const note = 'Payment submitted · Invoices included: ' + invoiceLabels.join(', ');
    if (liveMode) {
      try {
        const partnerId = await getCurrentPartnerId();
        const submitted = await submitInvoicePayment({
          partnerId,
          invoices: payable.map((invoice) => ({
            invoiceId: invoice.dbId,
            label: invoice.id,
          })),
          amount,
          reference,
          transferDate: draft.transferDate || localDateKey(new Date()),
          note,
          file: draft.file,
        });
        const pendingPayment = {
          id: submitted.id,
          invoiceId: invoiceLabels.join(', '),
          invoiceIds: submitted.invoice_ids || payable.map((invoice) => invoice.dbId),
          partnerId,
          partner: payable[0]?.partner || '',
          amount,
          reportedAmount: amount,
          reference,
          status: 'pending_verification',
          submittedAt: submitted.submitted_at || new Date().toISOString(),
        };
        setBilling((current) => ({
          ...current,
          payments: [pendingPayment, ...current.payments.filter((payment) => payment.id !== submitted.id)],
        }));
        setDrafts((current) => ({ ...current, [paymentKey]: {} }));
        paymentForm.reset();
        setNotice('Payment submitted successfully. It is waiting for admin review.');
        await refreshDatabaseFinance(true);
      } catch (error) {
        setPaymentError(error.message || 'Could not submit the payment.');
      }
      return;
    }
    const payment = {
      id: 'PAY-' + Date.now(),
      invoiceId: invoiceIds.join(', '),
      invoiceIds: payable.map((invoice) => invoice.dbId || invoice.id),
      invoiceDues: payable.map((invoice) => ({
        invoiceId: invoice.id,
        amount: Math.max(0, invoice.amount - getPaid(invoice.id)),
      })),
      allocations: [],
      partner: payable[0]?.partner || 'Style Hub',
      amount,
      reference,
      slipName: draft.slipName,
      status: 'pending_verification',
      submittedAt: new Date().toISOString(),
    };
    setBilling((current) => ({
      ...current,
      payments: [payment, ...current.payments],
      notifications: addNotification(
        current.notifications,
        'Payment submitted for review',
        invoiceIds.join(', ') + ' · ' + money(amount) + ' · ' + payment.partner
      ),
    }));
    setDrafts((current) => ({ ...current, [paymentKey]: {} }));
    paymentForm.reset();
    setNotice(
      'Demo payment submitted for review. The selected slip file was not uploaded.'
    );
  };
  const decidePayment = async (payment, status) => {
    const reviewDraft = paymentReviewDrafts[payment.id] || {};
    const verifiedAmount = Number(reviewDraft.amount ?? payment.amount);
    const rejectionReason = (reviewDraft.reason || '').trim();
    if (status === 'rejected' && !rejectionReason) {
      setPaymentReviewFeedback({ type: 'error', message: 'Enter a reason before rejecting this payment.' });
      return;
    }
    if (status === 'confirmed' && (!Number.isFinite(verifiedAmount) || verifiedAmount <= 0 || verifiedAmount > payment.amount)) {
      setPaymentReviewFeedback({ type: 'error', message: 'Enter the amount actually received, up to the amount reported by the partner.' });
      return;
    }
    if (liveMode) {
      setPaymentReviewBusyId(payment.id);
      setPaymentReviewFeedback({ type: 'progress', message: status === 'confirmed' ? 'Approving payment…' : 'Saving payment decision…' });
      try {
        await reviewPayment(payment.id, status, verifiedAmount, rejectionReason);
        await refreshDatabaseFinance(true);
        if (status === 'confirmed') {
          try {
            await sendPaymentReceipt(payment.id);
            setPaymentReviewFeedback({ type: 'success', message: 'Payment approved. The partner has been notified and emailed an itemized receipt.' });
          } catch (emailError) {
            setPaymentReviewFeedback({ type: 'success', message: 'Payment approved and partner notified, but the receipt email failed: ' + (emailError.message || 'Email service unavailable.') });
          }
        } else {
          setPaymentReviewFeedback({ type: 'success', message: 'Payment rejected. The partner has been notified with the rejection reason.' });
        }
        setPaymentReviewDrafts((current) => { const next = { ...current }; delete next[payment.id]; return next; });
      } catch (error) {
        setPaymentReviewFeedback({ type: 'error', message: error.message || 'Could not update payment.' });
      } finally {
        setPaymentReviewBusyId('');
      }
      return;
    }
    let allocations = [];
    let creditAmount = 0;
    if (status === 'confirmed') {
      let remaining = verifiedAmount;
      allocations = (payment.invoiceDues || []).map((invoice) => {
        const applied = Math.min(remaining, invoice.amount);
        remaining -= applied;
        return { invoiceId: invoice.invoiceId, amount: applied };
      }).filter((allocation) => allocation.amount > 0);
      creditAmount = remaining;
    }
    setBilling((current) => ({
      ...current,
      payments: current.payments.map((item) =>
        item.id === payment.id
          ? { ...item, status, verifiedAmount: status === 'confirmed' ? verifiedAmount : 0, allocations, creditAmount, rejectionReason, verifiedAt: new Date().toISOString() }
          : item
      ),
      notifications: addNotification(
        current.notifications,
        status === 'confirmed' ? 'Payment approved' : 'Payment needs attention',
        payment.invoiceId + ' · ' + payment.partner + ' · ' + money(verifiedAmount) + (rejectionReason ? ' · ' + rejectionReason : '')
      ),
    }));
    setPaymentReviewDrafts((current) => { const next = { ...current }; delete next[payment.id]; return next; });
    setNotice(
      status === 'confirmed'
        ? 'Demo payment approved. Invoice balances and any partner credit are updated in this browser.'
        : 'Demo payment rejected. The reason is included in the partner notification.'
    );
  };
  const invoiceList = (partnerMode) => {
    const visibleInvoices = billing.invoices.filter(
      (invoice) => !partnerMode || invoice.partner === 'Style Hub'
    );
    const headerCell = {
      padding: '11px 10px',
      color: '#65736c',
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '.04em',
      textAlign: 'left',
      textTransform: 'uppercase',
    };
    const cellStyle = {
      padding: '12px 10px',
      borderTop: '1px solid #e7ece9',
      verticalAlign: 'middle',
      fontSize: 13,
    };

    return (
      <div className="finance-invoice-table-wrap" style={{ overflowX: 'auto', border: '1px solid #e7ece9', borderRadius: 12 }}>
        <table className="finance-invoice-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', textAlign: 'left' }}>
          <colgroup>
            <col style={{ width: '19%' }} />
            <col style={{ width: '43%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '20%' }} />
          </colgroup>
          <thead style={{ background: '#f6f8f7' }}>
            <tr>
              <th scope="col" style={headerCell}>Status</th>
              <th scope="col" style={headerCell}>Invoice</th>
              <th scope="col" style={headerCell}>Total</th>
              <th scope="col" style={headerCell}>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleInvoices.map((invoice) => (
              <tr key={invoice.id}>
                <td style={cellStyle}>
                  <span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: getInvoiceStatus(invoice) === 'Paid' ? '#e8f5e9' : getInvoiceStatus(invoice) === 'Partially paid' ? '#e3f2fd' : '#fff4d6', color: getInvoiceStatus(invoice) === 'Paid' ? '#1b5e20' : getInvoiceStatus(invoice) === 'Partially paid' ? '#0d47a1' : '#8a5700' }}>
                    {getInvoiceStatus(invoice)}
                  </span>
                  {getPaid(invoice.id) > 0 && <small style={{ display: 'block', marginTop: 5 }}>{money(getPaid(invoice.id))} paid</small>}
                </td>
                <td style={{ ...cellStyle, overflowWrap: 'anywhere' }}>
                  <strong style={{ fontSize: 12 }}>{invoice.id}</strong>
                  <small style={{ display: 'block', marginTop: 4, color: '#65736c' }}>
                    {invoice.partner} · {invoice.period} · {invoice.lines.length} packages
                  </small>
                </td>
                <td style={{ ...cellStyle, whiteSpace: 'nowrap', fontWeight: 700 }}>{money(invoice.amount)}</td>
                <td style={cellStyle}>
                  <button type="button" style={{ ...buttonStyle, padding: '7px 9px', fontSize: 12, whiteSpace: 'nowrap' }} onClick={() => setViewingInvoice(invoice)}>
                    View invoice
                  </button>
                </td>
              </tr>
            ))}
            {!visibleInvoices.length && (
              <tr>
                <td colSpan="4" style={{ padding: 16, color: '#65736c', textAlign: 'center' }}>
                  No invoices yet. Admins can generate one after packages are delivered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      {!partnerMode && viewingInvoice && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-invoice-view-title"
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.58)', display: 'grid', placeItems: 'center', padding: 16 }}
        >
          <article className="invoice-preview" style={{ ...panel, marginTop: 0, width: 'min(760px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <p className="approval-kicker">IGO DELIVERY · INVOICE</p>
                <h2 id="admin-invoice-view-title" style={{ margin: '4px 0 0', overflowWrap: 'anywhere' }}>{viewingInvoice.id}</h2>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="no-print" type="button" style={buttonStyle} onClick={() => window.print()}>Print invoice</button>
                <button className="no-print" type="button" style={{ ...buttonStyle, background: '#56615c' }} onClick={() => setViewingInvoice(null)}>Close</button>
              </div>
            </header>
            <p><strong>Partner:</strong> {viewingInvoice.partner} · <strong>Status:</strong> {getInvoiceStatus(viewingInvoice)} · <strong>Period:</strong> {viewingInvoice.period}</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead><tr><th>Package</th><th>Customer</th><th>Destination</th><th>Description</th><th>Amount</th></tr></thead>
                <tbody>
                  {viewingInvoice.lines.map((line) => (
                    <tr key={line.packageId}>
                      <td>{line.packageId}</td><td>{line.customer}</td><td>{line.area}</td><td>{line.description}</td><td>{money(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ borderTop: '1px solid #e7e9e5', marginTop: 16, paddingTop: 14, textAlign: 'right', lineHeight: 1.9 }}>
              Invoice total: <strong>{money(viewingInvoice.amount)}</strong><br />
              Paid: <strong>{money(getPaid(viewingInvoice.id))}</strong><br />
              Amount due: <strong>{money(Math.max(0, viewingInvoice.amount - getPaid(viewingInvoice.id)))}</strong>
            </div>
          </article>
        </div>
      )}
      </div>
    );
  };
  if (workspace === 'Partner') {
    const partnerInvoices = liveMode ? billing.invoices : billing.invoices.filter((invoice) => invoice.partner === 'Style Hub');
    const payableInvoices = partnerInvoices.filter((invoice) => getInvoiceStatus(invoice) !== 'Paid');
    const payableInvoiceKeys = new Set(payableInvoices.flatMap((invoice) => [invoice.dbId, invoice.id]).filter(Boolean));
    const pendingPartnerPayments = billing.payments.filter((payment) =>
      payment.status === 'pending_verification' &&
      ((payment.invoiceIds || []).some((invoiceId) => payableInvoiceKeys.has(invoiceId)) ||
        (payment.invoiceDues || []).some((due) => payableInvoiceKeys.has(due.invoiceId)) ||
        payableInvoices.some((invoice) => String(payment.invoiceId || '').includes(invoice.id)))
    );
    const totalOutstanding = partnerInvoices.reduce((total, invoice) => total + Math.max(0, invoice.amount - getPaid(invoice.id)), 0);
    const partnerCredit = liveMode
      ? Number(billing.partnerCredits?.[partnerInvoices[0]?.partnerId] || 0)
      : billing.payments.filter((payment) => payment.partner === 'Style Hub' && payment.status === 'confirmed').reduce((sum, payment) => sum + Number(payment.creditAmount || 0), 0);
    return (
      <section style={{ paddingBottom: 28 }}>
        <p className="approval-kicker">PARTNER WORKSPACE · INVOICES</p>
        {workspace === 'Admin' && <h2>Invoices &amp; collections</h2>}
        <p>Rates are set at registration.</p>
        {!liveMode && <div className="notice">Demo only. Payments and slips aren't saved.</div>}

        <section id="partner-invoice-payment-options" style={panel}>
          <h3>Invoices</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>Only delivered packages are invoiced.</p>
          {partnerInvoices.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead><tr>{['Invoice', 'Status', 'Amount due', ''].map((label, index) => <th key={label || index} style={{ padding: '9px 8px', borderBottom: '1px solid #dfe7e2', whiteSpace: 'nowrap' }}>{label}</th>)}</tr></thead>
                <tbody>
                  {partnerInvoices.map((invoice) => {
                    const due = Math.max(0, invoice.amount - getPaid(invoice.id));
                    return <tr key={invoice.id} style={{ borderBottom: '1px solid #e7e9e5' }}>
                      <td style={{ padding: '9px 8px', whiteSpace: 'nowrap' }}><strong>{invoice.id}</strong></td>
                      <td style={{ padding: '9px 8px', whiteSpace: 'nowrap' }}>{getInvoiceStatus(invoice)}</td>
                      <td style={{ padding: '9px 8px', whiteSpace: 'nowrap' }}>{money(due)}</td>
                      <td style={{ padding: '9px 8px' }}><button type="button" style={{ ...buttonStyle, padding: '7px 10px', whiteSpace: 'nowrap' }} onClick={() => setViewingInvoice(invoice)}>View</button></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          ) : <p>No invoices yet.</p>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, margin: '12px 0', padding: '12px 0', borderTop: '1px solid #dfe7e2', borderBottom: '1px solid #dfe7e2' }}>
            <strong>Total due across invoices</strong><strong>{money(totalOutstanding)}</strong>
          </div>

          <div style={{ border: '1px solid #dfe7e2', borderRadius: 10, padding: 12, marginBottom: 14 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Account Details</h4>
            <div style={{ display: 'grid', gap: 6 }}>
              {[['Account name', billing.transferAccountName], ['Account number', billing.transferAccountNumber]].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}><span style={{ color: '#64748b' }}>{label}: </span><strong>{value || 'Not set by admin'}</strong></span>
                  <button type="button" style={{ ...buttonStyle, padding: '6px 9px' }} disabled={!value} onClick={() => navigator.clipboard?.writeText(value)}>Copy</button>
                </div>
              ))}
            </div>
          </div>

          {notice && !pendingPartnerPayments.length && <p role="status" className="notice" aria-live="polite">{notice}</p>}
          {paymentError && <p role="alert" style={{ background: '#fee2e2', color: '#7f1d1d', border: '1px solid #fca5a5', borderRadius: 8, padding: 12, margin: '8px 0' }}>{paymentError}</p>}
          {pendingPartnerPayments.length ? (
            <div className="notice" role="status" aria-live="polite">
              <strong>Payment submitted · Awaiting admin review</strong>
              {pendingPartnerPayments.map((payment) => (
                <p key={payment.id} style={{ marginBottom: 0 }}>
                  {money(payment.amount)} for {payment.invoiceId || 'your outstanding invoices'}
                  {payment.submittedAt ? ' · Submitted ' + new Date(payment.submittedAt).toLocaleString() : ''}.
                  {' '}Your payment slip was received. You can submit another payment after this one is reviewed.
                </p>
              ))}
            </div>
          ) : totalOutstanding > 0 ? (
            <form onSubmit={(event) => submitPayment(event, payableInvoices)} style={{ display: 'grid', gap: 10 }}>
              <p style={{ fontSize: 13, margin: 0 }}>All outstanding invoices are included. Enter the total actually transferred; the admin will verify it against the payment slip.</p>
              {partnerCredit > 0 && <p style={{ margin: 0 }}>Usable partner credit: <strong>{money(partnerCredit)}</strong>. Credit is applied automatically to new invoices.</p>}
              <label>Amount transferred (MVR)<input required type="number" min="0.01" step="0.01" value={drafts['all-outstanding-invoices']?.amount ?? totalOutstanding} onChange={(event) => setDrafts((current) => ({ ...current, 'all-outstanding-invoices': { ...current['all-outstanding-invoices'], amount: event.target.value } }))} /></label>
              <div className="payment-slip-field">
                <label htmlFor="partner-payment-slip">Payment slip</label>
                <input
                  id="partner-payment-slip"
                  className="payment-slip-input"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                  aria-describedby="partner-payment-slip-help"
                  onChange={(event) => {
                    setPaymentError('');
                    setDrafts((current) => ({
                      ...current,
                      'all-outstanding-invoices': {
                        ...current['all-outstanding-invoices'],
                        slipName: event.target.files?.[0]?.name || '',
                        file: event.target.files?.[0] || null,
                      },
                    }));
                  }}
                />
                <label className="payment-slip-trigger" htmlFor="partner-payment-slip">
                  {drafts['all-outstanding-invoices']?.slipName ? 'Change payment slip' : 'Choose payment slip'}
                </label>
                <span className="payment-slip-status" role="status" aria-live="polite">
                  {drafts['all-outstanding-invoices']?.slipName
                    ? 'Selected: ' + drafts['all-outstanding-invoices'].slipName
                    : 'No file selected yet'}
                </span>
                <small id="partner-payment-slip-help">Choose a JPG, PNG, WebP, or PDF file · maximum 10 MB</small>
              </div>
              <button style={buttonStyle} type="submit">Submit payment for review</button>
            </form>
          ) : <p>There are no outstanding invoices to pay.{partnerCredit > 0 ? ' Your usable credit will apply automatically to new invoices.' : ''}</p>}

          {viewingInvoice && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="invoice-view-title"
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1000,
                background: 'rgba(15,23,42,.58)',
                display: 'grid',
                placeItems: 'center',
                padding: 16,
              }}
            >
              <article
                style={{
                  width: 'min(760px,100%)',
                  maxHeight: '92vh',
                  overflowY: 'auto',
                  background: '#fff',
                  borderRadius: 18,
                  padding: 24,
                  boxShadow: '0 24px 80px rgba(0,0,0,.24)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '2px solid #174f3c',
                    paddingBottom: 12,
                  }}
                >
                  <div>
                    <p className="approval-kicker">IGO DELIVERY · INVOICE</p>
                    <h2 id="invoice-view-title">{viewingInvoice.id}</h2>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      style={buttonStyle}
                      type="button"
                      onClick={() => window.print()}
                    >
                      Print invoice
                    </button>
                    <button
                      style={buttonStyle}
                      type="button"
                      onClick={() => setViewingInvoice(null)}
                    >
                      Close
                    </button>
                  </div>
                </div>
                <p>
                  <strong>Partner:</strong> {viewingInvoice.partner}　 <strong>Status:</strong>{' '}
                  {getInvoiceStatus(viewingInvoice)}
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      textAlign: 'left',
                      fontSize: 13,
                    }}
                  >
                    <thead>
                      <tr>
                        {[
                          'Package',
                          'Recipient',
                          'Destination',
                          'Details',
                          'Fee (MVR)',
                        ].map((x) => (
                          <th
                            key={x}
                            style={{
                              padding: 10,
                              background: '#f3f5f4',
                              borderBottom: '1px solid #dfe4e1',
                            }}
                          >
                            {x}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {viewingInvoice.lines.map((line) => (
                        <tr key={line.packageId}>
                          {[
                            line.packageId,
                            line.customer,
                            line.area,
                            line.description,
                            money(line.amount),
                          ].map((x, i) => (
                            <td
                              key={i}
                              style={{
                                padding: 10,
                                borderBottom: '1px solid #e8ece9',
                              }}
                            >
                              {x}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div
                  style={{
                    textAlign: 'right',
                    paddingTop: 16,
                    lineHeight: 1.9,
                  }}
                >
                  Invoice total: <strong>{money(viewingInvoice.amount)}</strong>
                  <br />
                  Paid: <strong>{money(getPaid(viewingInvoice.id))}</strong>
                  <br />
                  <span style={{ fontSize: 18 }}>
                    Amount due:{' '}
                    <strong>
                      {money(
                        Math.max(
                          0,
                          viewingInvoice.amount - getPaid(viewingInvoice.id)
                        )
                      )}
                    </strong>
                  </span>
                </div>
              </article>
            </div>
          )}
        </section>
      </section>
    );
  }
  const pendingPayments = billing.payments.filter(
    (payment) => payment.status === 'pending_verification'
  );
  const monthKey = (value) => localDateKey(value).slice(0, 7);
  const previousOverviewMonth = (() => {
    const date = new Date(overviewMonth + '-01T00:00:00');
    date.setMonth(date.getMonth() - 1);
    return String(date.getFullYear()) + '-' + String(date.getMonth() + 1).padStart(2, '0');
  })();
  const overviewMonthLabel = (month) =>
    new Date(month + '-01T00:00:00').toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  const overviewTotalsForMonth = (month) => {
    const monthDeliveries = deliveredPackages
      .filter((delivery) => monthKey(delivery.deliveredAt || delivery.updatedAt || delivery.createdAt) === month);
    const deliveredValue = monthDeliveries
      .reduce((sum, delivery) => sum + Number(delivery.fee ?? delivery.delivery_fee ?? 0), 0);
    const driverShareIsComplete = overviewDriverRatesReady && monthDeliveries.every((delivery) =>
      !delivery.driver || (Object.prototype.hasOwnProperty.call(overviewDriverRates, delivery.driver) && Number.isFinite(Number(overviewDriverRates[delivery.driver])))
    );
    const estimatedDriverShares = driverShareIsComplete
      ? monthDeliveries.reduce((sum, delivery) => {
          const fee = Number(delivery.fee ?? delivery.delivery_fee ?? 0);
          const rate = Number(overviewDriverRates[delivery.driver] || 0);
          return sum + fee * rate / 100;
        }, 0)
      : null;
    const recordedExpenses = billing.expenses
      .filter((expense) => monthKey(expense.date || expense.expense_date || expense.recordedAt) === month)
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const estimatedOperatingResult = estimatedDriverShares === null
      ? null
      : deliveredValue - estimatedDriverShares - recordedExpenses;
    const outstandingInvoices = billing.invoices
      .filter((invoice) => monthKey(invoice.createdAt) === month)
      .reduce((sum, invoice) => sum + Math.max(0, Number(invoice.amount || 0) - getPaid(invoice.id)), 0);
    const payments = billing.payments
      .filter((payment) => payment.status === 'confirmed' && monthKey(payment.verifiedAt || payment.transferDate || payment.submittedAt) === month)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const withdrawals = withdrawalRequests
      .filter((request) => request.status === 'paid' && monthKey(request.paid_at || request.reviewedAt || request.requestedAt) === month)
      .reduce((sum, request) => sum + Number(request.amount || 0), 0);
    return {
      deliveredValue,
      estimatedDriverShares,
      recordedExpenses,
      estimatedOperatingResult,
      outstandingInvoices,
      payments,
      netAfterWithdrawals: payments - withdrawals,
    };
  };
  const overviewTotals = overviewTotalsForMonth(overviewMonth);
  const previousOverviewTotals = overviewTotalsForMonth(previousOverviewMonth);
  const overviewComparison = (current, previous) => {
    const difference = current - previous;
    const sign = difference > 0 ? '+' : difference < 0 ? '−' : '';
    return sign + money(Math.abs(difference)) + ' vs ' + overviewMonthLabel(previousOverviewMonth);
  };
  const reportRows = [
    ...billing.payments
      .filter((payment) => payment.status === 'confirmed')
      .map((payment) => ({
        date: payment.verifiedAt || payment.submittedAt,
        type: 'Received payment',
        reference: payment.invoiceId || payment.reference || payment.id,
        party: payment.partner || 'Partner',
        details: 'Transfer reference ' + (payment.reference || '—'),
        income: Number(payment.amount || 0),
        outgoing: 0,
      })),
    ...withdrawalRequests
      .filter((request) => request.status === 'paid')
      .map((request) => ({
        date: request.paid_at || request.reviewedAt || request.requestedAt,
        type: 'Driver withdrawal',
        reference: shortWithdrawalRequestId(request.id),
        party: request.driver,
        details: [
          request.bankDetails?.bankName,
          request.bankDetails?.accountHolder,
          request.bankDetails?.accountNumber,
        ].filter(Boolean).join(' · '),
        income: 0,
        outgoing: Number(request.amount || 0),
      })),
    ...(billing.expenses || []).map((expense) => {
      const fullReference = expense.reference || shortExpenseRecordId(expense.id);
      return {
        date: expense.date,
        type: 'Expense · ' + expense.category,
        reference: compactExpenseReference(fullReference),
        fullReference,
        party: expense.paidTo || '—',
        details: expense.description,
        income: 0,
        outgoing: Number(expense.amount || 0),
      };
    }),
  ]
    .filter((row) => {
      const day = localDateKey(row.date);
      return day && day >= reportPeriod.start && day <= reportPeriod.end;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const reportReceived = reportRows.reduce((sum, row) => sum + row.income, 0);
  const reportOutgoings = reportRows.reduce((sum, row) => sum + row.outgoing, 0);
  const reportNet = reportReceived - reportOutgoings;
  const generateFinancialReport = (event) => {
    event.preventDefault();
    if (!reportStart || !reportEnd || reportStart > reportEnd) {
      setNotice('Choose a valid report date range.');
      return;
    }
    setReportPeriod({ start: reportStart, end: reportEnd });
    setReportGeneratedAt(new Date().toISOString());
    setNotice('Financial report generated.');
  };
  const generateDailySalesReport = (event) => {
    event.preventDefault();
    if (!dailySalesDate) return;
    setDailySalesGenerated({ date: dailySalesDate, generatedAt: new Date().toISOString() });
  };
  const exportDailySalesReport = () => {
    const fields = ['Date', 'Invoice', 'Partner', 'Package', 'Customer', 'Delivery fee (MVR)', 'Invoice status'];
    const rows = dailySalesRows.map((row) => [row.date, row.invoice, row.partner, row.packageId, row.customer, row.amount.toFixed(2), row.invoiceStatus]);
    const csvValue = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const content = [fields, ...rows].map((row) => row.map(csvValue).join(',')).join('\r\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'igo-daily-sales-' + dailySalesGenerated.date + '.csv';
    link.click();
    URL.revokeObjectURL(url);
  };
  const recordExpense = async (event) => {
    event.preventDefault();
    const amount = Number(expenseDraft.amount);
    if (!expenseDraft.description.trim() || !expenseDraft.paidTo.trim() || !expenseDraft.date || amount <= 0) {
      setNotice('Enter the expense date, description, paid-to name, and a positive amount.');
      return;
    }
    const expense = {
      id: 'EXP-' + Date.now(),
      date: expenseDraft.date,
      category: expenseDraft.category,
      description: expenseDraft.description.trim(),
      paidTo: expenseDraft.paidTo.trim(),
      amount,
      reference: expenseDraft.reference.trim(),
      recordedAt: new Date().toISOString(),
    };
    if (liveMode) {
      try {
        await createBusinessExpense(expense);
        await refreshDatabaseFinance(true);
      } catch (error) {
        setNotice(error.message || 'Could not record this expense.');
        return;
      }
    } else setBilling((current) => ({ ...current, expenses: [expense, ...(current.expenses || [])] }));
    setExpenseDraft({ date: localDateKey(new Date()), category: 'Fuel / petrol', description: '', paidTo: '', amount: '', reference: '' });
    setNotice(liveMode ? 'Expense saved to the finance records.' : 'Expense recorded in this demo.');
  };
  const persistPaymentAccount = async () => {
    if (!liveMode) {
      setNotice('Payment account settings are saved in this demo.');
      return;
    }
    try {
      const saved = await savePaymentAccount({
        id: paymentAccountId,
        accountName: billing.transferAccountName?.trim(),
        accountNumber: billing.transferAccountNumber?.trim(),
        currency: 'MVR',
      });
      setPaymentAccountId(saved.id);
      setNotice('Payment account details saved.');
    } catch (error) {
      setNotice(error.message || 'Could not save payment account details.');
    }
  };
  const persistInvoiceCutoff = async () => {
    if (!liveMode) {
      setNotice('Daily cutoff saved in this demo.');
      return;
    }
    try {
      await saveInvoiceCutoff(billing.cutoff);
      setNotice('Daily invoice cutoff saved. Automatic generation runs at this local time.');
    } catch (error) {
      setNotice(error.message || 'Could not save the invoice cutoff.');
    }
  };
  const exportFinancialReport = () => {
    const fields = ['Date', 'Type', 'Reference', 'Payee / From', 'Details', 'Received (MVR)', 'Outgoing (MVR)'];
    const rows = reportRows.map((row) => [localDateKey(row.date), row.type, row.fullReference || row.reference, row.party, row.details, row.income.toFixed(2), row.outgoing.toFixed(2)]);
    const csvValue = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const content = [fields, ...rows].map((row) => row.map(csvValue).join(',')).join('\r\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'igo-financial-report-' + reportPeriod.start + '-to-' + reportPeriod.end + '.csv';
    link.click();
    URL.revokeObjectURL(url);
  };
  const signInAdmin = async (event) => {
    event.preventDefault();
    if (!supabase) {
      setLiveError(
        'Supabase connection settings are not configured for this preview.'
      );
      return;
    }
    setLiveBusy(true);
    setLiveError('');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPassword,
    });
    if (error) {
      setLiveError(error.message);
      setLiveBusy(false);
      return;
    }
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .maybeSingle();
    if (profileError || profile?.role !== 'admin') {
      await supabase.auth.signOut();
      setAdminUser(null);
      setLiveError(
        profileError?.message ||
          'This account is not assigned the iGO admin role.'
      );
      setLiveBusy(false);
      return;
    }
    setAdminUser(data.user);
    setAuthPassword('');
    try {
      await refreshLiveInvoices();
    } catch (loadError) {
      setLiveError(loadError.message || 'Could not load invoices.');
    }
    setLiveBusy(false);
  };
  const signOutAdmin = async () => {
    if (supabase) await supabase.auth.signOut();
    setAdminUser(null);
    setLiveInvoices([]);
    setLiveMessage('');
  };
  const generateLiveInvoices = async (partnerId = null) => {
    if (!supabase || !adminUser) {
      setLiveError('Sign in with an iGO admin account to generate live invoices.');
      return;
    }
    setLiveBusy(true);
    setLiveError('');
    setLiveMessage('');
    let generationCompleted = false;
    try {
      const { data, error } = await supabase.rpc('generate_delivered_invoices', {
        p_partner_id: partnerId,
      });
      if (error) throw error;
      generationCompleted = true;
      await refreshLiveInvoices();
      await refreshDatabaseFinance(true);
      if (data?.length) {
        setLiveMessage(
          'Generated ' + data.length + ' live invoice(s). Each partner was notified.'
        );
      } else if (readyPackages.length > 0) {
        setLiveError(
          'No invoice was generated, although ' + readyPackages.length +
          ' package(s) still appear ready here. The package list and invoice service disagree. Refresh the data and check again before retrying.'
        );
      } else {
        setLiveMessage(
          'No delivered, uninvoiced packages are ready. The daily cutoff does not affect manual generation.'
        );
      }
    } catch (error) {
      const prefix = generationCompleted
        ? 'The invoice request completed, but the latest records could not be refreshed. '
        : 'Invoice generation failed. ';
      setLiveError(prefix + (error.message || 'Please refresh and try again.'));
    } finally {
      setLiveBusy(false);
    }
  };
  const liveAdminPanel = (
    <section style={panel}>
      <p className="approval-kicker">LIVE DATABASE · ADMIN ONLY</p>
      <h3>Manual invoice generation</h3>
      <p>Create invoices for delivered packages anytime.</p>
      {!supabaseConfigured ? (
        <p className="notice">
          Live actions unavailable: Supabase settings missing.
        </p>
      ) : !adminUser ? (
        <form
          onSubmit={signInAdmin}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
            gap: 12,
            alignItems: 'end',
          }}
        >
          <label>
            Admin email
            <input
              type="email"
              autoComplete="username"
              required
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
            />
          </label>
          <label>
            Admin password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
            />
          </label>
          <button style={buttonStyle} type="submit" disabled={liveBusy}>
            {liveBusy ? 'Signing in…' : 'Sign in as admin'}
          </button>
        </form>
      ) : (
        <>
          <p>Signed in as {adminUser.email} · live invoice access verified</p>
          <button
            style={buttonStyle}
            onClick={generateLiveInvoices}
            disabled={liveBusy}
          >
            {liveBusy ? 'Working…' : 'Generate live invoices now'}
          </button>
          <button
            style={{ ...buttonStyle, marginLeft: 8, background: '#56615c' }}
            onClick={signOutAdmin}
          >
            Sign out
          </button>
          <h4>Live invoices</h4>
          {liveInvoices.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  textAlign: 'left',
                }}
              >
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Partner</th>
                    <th>Delivery period</th>
                    <th>Packages</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {liveInvoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <strong>{invoice.invoice_number}</strong>
                      </td>
                      <td>{invoice.partners?.name || invoice.partner_id}</td>
                      <td>
                        {new Date(invoice.period_start).toLocaleDateString()} –{' '}
                        {new Date(invoice.period_end).toLocaleDateString()}
                      </td>
                      <td>{invoice.invoice_items?.length || 0}</td>
                      <td>{money(invoice.subtotal)}</td>
                      <td>{invoice.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No live invoices yet.</p>
          )}
        </>
      )}
      {liveError && (
        <p role="alert" style={{ color: '#8a2d2d' }}>
          {liveError}
        </p>
      )}
      {liveMessage && <p role="status">{liveMessage}</p>}
    </section>
  );
  return (
    <section style={{ paddingBottom: 28 }}>
      {mode === 'management' && (
        <nav aria-label="Finance sections" style={{ display: 'flex', alignItems: 'stretch', gap: 4, overflowX: 'auto', whiteSpace: 'nowrap', padding: '0 2px', marginBottom: 18, borderBottom: '1px solid #dfe7e2' }}>
          {[
            ['Invoices', 'Invoices & collections'],
            ['Expenses', 'Record business expense'],
            [workspace === 'Admin' ? 'Day-end' : 'Reports', workspace === 'Admin' ? 'Day-end report' : 'Daily sales report'],
            ['Settings', 'Payment account settings'],
          ].map(([label, target]) => (
            <button
              key={target}
              type="button"
              style={{ flex: '0 0 auto', padding: '12px 15px', background: 'transparent', color: activeFinanceTab === label ? '#155b43' : '#65736c', border: 0, borderBottom: activeFinanceTab === label ? '3px solid #17634b' : '3px solid transparent', borderRadius: 0, boxShadow: 'none', fontSize: 13, fontWeight: activeFinanceTab === label ? 700 : 600, cursor: 'pointer' }}
              onClick={() => {
                setActiveFinanceTab(label);
                const sectionHeading = Array.from(document.querySelectorAll('h2, h3')).find((heading) => heading.textContent.trim().includes(target));
                sectionHeading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      {mode === 'management' && <h2>Invoices &amp; collections</h2>}
      {!liveMode && <div className="notice">Demo mode.</div>}
      <section style={panel}>
        <h3>Invoices</h3>{mode === 'management' && <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 10, marginBottom: 14 }}>
            <label>Daily cutoff <input type="time" value={billing.cutoff} onChange={(event) => setBilling((current) => ({ ...current, cutoff: event.target.value }))} /></label>
            <button type="button" style={buttonStyle} onClick={persistInvoiceCutoff}>Save cutoff</button>
            <span>
              Ready to invoice: <strong>{readyPackages.length}</strong> · {money(readyPackages.reduce((sum, packageItem) => sum + Number(packageItem.fee ?? packageItem.delivery_fee ?? 0), 0))}
            </span>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => generateInvoices()}
              disabled={liveBusy || (liveMode && !adminUser) || readyPackages.length === 0}
              title={readyPackages.length === 0 ? 'No delivered packages are ready to invoice' : undefined}
            >
              {liveBusy ? 'Generating…' : liveMode ? 'Generate for all partners' : 'Generate demo invoices for all'}
            </button>
            {readyPackages.length === 0 && <span style={{ fontSize: 12, color: '#64748b' }}>No delivered packages ready to invoice.</span>}
          </div>
          {readyPartners.length > 0 && (
            <section className="ready-partners" aria-labelledby="ready-partners-heading">
              <div className="ready-partners-heading">
                <h4 id="ready-partners-heading">Ready to invoice by partner</h4>
                <label className="ready-partner-search">
                  <span className="visually-hidden">Search partners ready to invoice</span>
                  <input type="search" value={readyPartnerSearch} onChange={(event) => setReadyPartnerSearch(event.target.value)} placeholder="Search partners" aria-label="Search partners ready to invoice" />
                </label>
              </div>
              <div className="ready-partners-table-wrap">
                <table className="ready-partners-table">
                  <thead><tr><th scope="col">Partner</th><th scope="col">Packages</th><th scope="col">Amount</th><th scope="col"><span className="visually-hidden">Action</span></th></tr></thead>
                  <tbody>
                    {visibleReadyPartners.map((partner) => (
                      <tr key={partner.key}>
                        <th scope="row">{partner.name}{liveMode && !partner.id && <small className="ready-partner-warning">Partner account could not be identified; refresh before generating.</small>}</th>
                        <td>{partner.count}</td>
                        <td>{money(partner.amount)}</td>
                        <td><button type="button" style={buttonStyle} onClick={() => generateInvoices(partner.id || null, partner.name)} disabled={liveBusy || (liveMode && (!adminUser || !partner.id))} title={liveMode && !partner.id ? 'Partner account ID is missing' : undefined}>{liveBusy ? 'Generating…' : 'Generate invoice'}</button></td>
                      </tr>
                    ))}
                    {visibleReadyPartners.length === 0 && <tr><td colSpan="4" className="ready-partners-empty">No partners match “{readyPartnerSearch}”.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        {!adminUser&&liveMode&&<form onSubmit={signInAdmin} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,alignItems:"end",marginBottom:12}}><label>Admin email<input type="email" autoComplete="username" required value={authEmail} onChange={(e)=>setAuthEmail(e.target.value)}/></label><label>Admin password<input type="password" autoComplete="current-password" required value={authPassword} onChange={(e)=>setAuthPassword(e.target.value)}/></label><button style={buttonStyle} type="submit" disabled={liveBusy}>{liveBusy?"Working…":"Sign in as admin"}</button></form>}{liveError&&<p role="alert" style={{color:"#8a2d2d"}}>{liveError}</p>}{liveMessage&&<p role="status">{liveMessage}</p>}</>}
        {invoiceList(false)}
      </section>
      {mode === 'management' && (
      <>
      <section id="admin-payment-review" style={panel}>
        <h3>Payments awaiting review</h3>
        {paymentReviewFeedback && <p role={paymentReviewFeedback.type === 'error' ? 'alert' : 'status'} aria-live={paymentReviewFeedback.type === 'error' ? 'assertive' : 'polite'} className="notice" style={paymentReviewFeedback.type === 'error' ? { color: '#7f1d1d', background: '#fee2e2', border: '1px solid #fca5a5' } : undefined}>{paymentReviewFeedback.message}</p>}
        {pendingPayments.length ? (
          pendingPayments.map((payment) => {
            const invoiceDues = (payment.invoiceDues || []).filter((invoice) => invoice?.invoiceId);
            const invoiceLabels = invoiceDues.length
              ? invoiceDues.map((invoice) => invoice.invoiceId)
              : String(payment.invoiceId || '').split(',').map((invoiceId) => invoiceId.trim()).filter(Boolean);
            const invoiceBalanceTotal = invoiceDues.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
            const compactInvoiceId = (invoiceId) => (
              invoiceId.length <= 24
                ? invoiceId
                : invoiceId.slice(0, invoiceId.startsWith('INV-') ? 13 : 12) + '…' + invoiceId.slice(-6)
            );
            return (
              <article className="payment-review-card" key={payment.id}>
                <header className="payment-review-header">
                  <div className="payment-review-title">
                    <strong className="payment-review-partner">{payment.partner || 'Partner'}</strong>
                    <div className="payment-review-invoices" aria-label="Invoices included in this payment">
                      <span className="payment-review-count">{invoiceLabels.length} invoice{invoiceLabels.length === 1 ? '' : 's'}</span>
                      {invoiceLabels.slice(0, 2).map((invoiceId) => (
                        <code key={invoiceId} title={invoiceId}>{compactInvoiceId(invoiceId)}</code>
                      ))}
                      {invoiceLabels.length > 2 && <span className="payment-review-more">+{invoiceLabels.length - 2} more</span>}
                    </div>
                  </div>
                  <strong className="payment-review-amount">{money(payment.amount)}</strong>
                </header>
                {invoiceLabels.length > 0 && (
                  <details className="payment-review-receipt">
                    <summary>View payment receipt</summary>
                    <div className="payment-receipt">
                      <header className="payment-receipt-heading">
                        <div><span>Payment receipt</span><strong>{payment.partner || 'Partner'}</strong></div>
                        <strong className="payment-receipt-total">{money(payment.amount)}</strong>
                      </header>
                      <div className="payment-receipt-summary">
                        <div><span>Invoices included</span><strong>{invoiceLabels.length}</strong></div>
                        <div><span>Invoice balance total</span><strong>{invoiceDues.length ? money(invoiceBalanceTotal) : 'Unavailable'}</strong></div>
                        <div><span>Reference</span><strong>{payment.reference || '—'}</strong></div>
                        <div><span>Transfer date</span><strong>{payment.transferDate || '—'}</strong></div>
                      </div>
                      <ol className="payment-receipt-invoices">
                        {invoiceLabels.map((invoiceId, index) => {
                          const invoice = invoiceDues.find((item) => item.invoiceId === invoiceId);
                          return (
                            <li key={invoiceId}>
                              <div className="payment-receipt-invoice-heading">
                                <code>{invoiceId}</code>
                                <strong>{invoice ? money(invoice.amount) : 'Amount unavailable'}</strong>
                              </div>
                              {invoice?.lines?.length > 0 && (
                                <ul>
                                  {invoice.lines.map((line, lineIndex) => (
                                    <li key={line.id || lineIndex}>
                                      <span>{line.description || line.packageId || 'Invoice item'}</span>
                                      <span>{money(line.amount)}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                      <p>Invoice amounts show the outstanding balance available when this payment was submitted. Compare the itemized invoices with the payment slip above.</p>
                    </div>
                  </details>
                )}
                <div className="payment-review-metadata">
                  <div><span>Reference</span><strong>{payment.reference || '—'}</strong></div>
                  <div><span>Transfer date</span><strong>{payment.transferDate || '—'}</strong></div>
                  <div><span>Payment slip</span><PaymentSlipLink path={payment.slipPath} name={payment.slipName} /></div>
                </div>
                <div className="payment-review-fields">
                  <label>
                    Amount verified received (MVR)
                    <input
                      type="number"
                      min="0.01"
                      max={payment.amount}
                      step="0.01"
                      value={paymentReviewDrafts[payment.id]?.amount ?? payment.amount}
                      onChange={(event) => setPaymentReviewDrafts((current) => ({ ...current, [payment.id]: { ...current[payment.id], amount: event.target.value } }))}
                    />
                  </label>
                  <label>
                    Rejection reason
                    <textarea
                      rows={2}
                      value={paymentReviewDrafts[payment.id]?.reason || ''}
                      onChange={(event) => setPaymentReviewDrafts((current) => ({ ...current, [payment.id]: { ...current[payment.id], reason: event.target.value } }))}
                      placeholder="Explain what needs to be corrected"
                    />
                  </label>
                </div>
                <p className="payment-review-hint">Any amount above the included invoice balances becomes usable partner credit.</p>
                <div className="payment-review-actions">
                  <button type="button" style={buttonStyle} disabled={paymentReviewBusyId === payment.id} onClick={() => decidePayment(payment, 'confirmed')}>
                    {paymentReviewBusyId === payment.id ? 'Approving…' : 'Approve verified amount'}
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonStyle, background: '#8a2d2d', opacity: paymentReviewDrafts[payment.id]?.reason?.trim() ? 1 : 0.55 }}
                    disabled={!paymentReviewDrafts[payment.id]?.reason?.trim()}
                    onClick={() => decidePayment(payment, 'rejected')}
                  >
                    Reject with reason
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <p>None pending.</p>
        )}
      </section>
      <section id="admin-withdrawal-requests" style={panel}>
        <h3>Driver withdrawal requests</h3>
        <p>New requests: <strong>{withdrawalRequests.filter((request) => request.status === 'pending').length}</strong> · Review bank details and record decisions.</p>
        {withdrawalRequests.length ? (
          withdrawalRequests
            .slice()
            .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))
            .map((request) => (
              <article className="application-card" key={request.id} style={{ padding: 14, marginBottom: 10 }}>
                <strong>{request.driver} · MVR {Number(request.amount).toFixed(2)}</strong>
                <p><span title={request.id}>{shortWithdrawalRequestId(request.id)}</span> · Requested {new Date(request.requestedAt).toLocaleString()}</p>
                <p>Status: <strong>{request.status}</strong>{request.reviewedAt ? ' · Reviewed ' + new Date(request.reviewedAt).toLocaleString() : ''}</p>
                <p>Bank: {request.bankDetails?.bankName || 'Not provided'} · Account name: {request.bankDetails?.accountHolder || 'Not provided'}</p>
                <p>Account number: {request.bankDetails?.accountNumber || 'Not provided'}{request.bankDetails?.branch ? ' · Branch: ' + request.bankDetails.branch : ''}</p>
                {request.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button style={buttonStyle} onClick={() => decideDriverWithdrawal(request.id, 'approved')}>Approve withdrawal</button>
                    <button style={{ ...buttonStyle, background: '#8a2d2d' }} onClick={() => decideDriverWithdrawal(request.id, 'rejected')}>Reject request</button>
                  </div>
                )}
                {request.status === 'approved' && <button style={buttonStyle} onClick={() => decideDriverWithdrawal(request.id, 'paid')}>Record payment made</button>}
              </article>
            ))
        ) : (
          <p>No driver withdrawal requests.</p>
        )}
      </section>
      <section style={panel}>
        <h3>Record business expense</h3>
        <p>Record paid costs such as petrol, maintenance, or supplies.</p>
        <form onSubmit={recordExpense} className="finance-expense-form">
          <label>Date<input type="date" required value={expenseDraft.date} onChange={(event) => setExpenseDraft((current) => ({ ...current, date: event.target.value }))} /></label>
          <label>Category<select value={expenseDraft.category} onChange={(event) => setExpenseDraft((current) => ({ ...current, category: event.target.value }))}>{['Fuel / petrol', 'Vehicle maintenance', 'Supplies', 'Rent', 'Utilities', 'Other'].map((category) => <option key={category}>{category}</option>)}</select></label>
          <label>Description<input required placeholder="Petrol for delivery van" value={expenseDraft.description} onChange={(event) => setExpenseDraft((current) => ({ ...current, description: event.target.value }))} /></label>
          <label>Paid to<input required placeholder="Supplier or recipient" value={expenseDraft.paidTo} onChange={(event) => setExpenseDraft((current) => ({ ...current, paidTo: event.target.value }))} /></label>
          <label>Amount (MVR)<input type="number" min="0.01" step="0.01" required value={expenseDraft.amount} onChange={(event) => setExpenseDraft((current) => ({ ...current, amount: event.target.value }))} /></label>
          <label>Receipt / reference (optional)<input value={expenseDraft.reference} onChange={(event) => setExpenseDraft((current) => ({ ...current, reference: event.target.value }))} /></label>
          <button style={buttonStyle} type="submit">Record paid expense</button>
        </form>
      </section>
      {workspace === 'Admin' && <DayEndReport packages={packages} invoices={billing.invoices} payments={billing.payments} expenses={billing.expenses} withdrawals={withdrawalRequests} />}
      {workspace !== 'Admin' && (
      <section style={panel}>
        <h3>Daily sales report</h3>
        <form onSubmit={generateDailySalesReport} className="finance-report-controls no-print">
          <label>Date<input type="date" required value={dailySalesDate} onChange={(event) => setDailySalesDate(event.target.value)} /></label>
          <button style={buttonStyle} type="submit">Generate report</button>
        </form>
        {dailySalesGenerated && (
          <>
            <details open className="daily-sales-report-details">
  <summary>Daily sales report details</summary>
  <p className="finance-report-meta">{dailySalesGenerated.date} · Generated {new Date(dailySalesGenerated.generatedAt).toLocaleString()}</p>
            <div className="stats-grid finance-report-totals">
              <article className="stat-card"><span>Delivered packages</span><strong>{dailySalesRows.length}</strong></article>
              <article className="stat-card"><span>Delivery sales</span><strong>{money(dailySalesTotal)}</strong></article>
            </div>
            <div className="finance-report-actions no-print">
              <button style={{ ...buttonStyle, background: '#48564f' }} type="button" onClick={exportDailySalesReport}>Export CSV</button>
            </div>
            <div className="finance-report-table-wrap">
              <table className="finance-report-table">
                <thead><tr><th>Invoice</th><th>Partner</th><th>Package</th><th>Customer</th><th>Fee</th><th>Status</th></tr></thead>
                <tbody>
                  {dailySalesRows.length ? dailySalesRows.map((row) => (
                    <tr key={row.packageId}>
                      <td>{row.invoice}</td><td>{row.partner}</td><td>{row.packageId}</td><td>{row.customer}</td><td>{money(row.amount)}</td><td>{row.invoiceStatus}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan="6">No delivered packages for this date.</td></tr>
                  )}
                  <tr><th colSpan="4">Total sales</th><th>{money(dailySalesTotal)}</th><td /></tr>
                </tbody>
              </table>
            </div>
            </details>
          </>
        )}
      </section>
      )}
      <section className="finance-report-print" style={panel}>
        <div className="finance-report-heading">
          <div>
            <p className="approval-kicker">IGO DELIVERY · FINANCE</p>
            <h3>Financial report</h3>
            <p>Received payments, driver withdrawals, and business expenses.</p>
          </div>
        </div>
        <form onSubmit={generateFinancialReport} className="finance-report-controls no-print">
          <label>From<input type="date" required value={reportStart} onChange={(event) => setReportStart(event.target.value)} /></label>
          <label>To<input type="date" required value={reportEnd} onChange={(event) => setReportEnd(event.target.value)} /></label>
          <button style={buttonStyle} type="submit">Generate report</button>
        </form>
        {reportGeneratedAt ? (
          <>
            <p className="finance-report-meta">Period: {reportPeriod.start} to {reportPeriod.end} · Generated {new Date(reportGeneratedAt).toLocaleString()}</p>
            <div className="stats-grid finance-report-totals">
              <article className="stat-card"><span>Payments received</span><strong>{money(reportReceived)}</strong></article>
              <article className="stat-card"><span>Total outgoings</span><strong>{money(reportOutgoings)}</strong></article>
              <article className="stat-card"><span>Net cash flow</span><strong>{money(reportNet)}</strong></article>
            </div>
            <div className="finance-report-actions no-print">
              <button style={buttonStyle} type="button" onClick={() => window.print()}>Print report</button>
              <button style={{ ...buttonStyle, background: '#48564f' }} type="button" onClick={exportFinancialReport}>Export CSV</button>
            </div>
            <div className="finance-report-table-wrap">
              <table className="finance-report-table">
                <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Payee / From</th><th>Details</th><th>Received</th><th>Outgoing</th></tr></thead>
                <tbody>
                  {reportRows.length ? reportRows.map((row, index) => (
                    <tr key={row.reference + '-' + index}>
                      <td>{localDateKey(row.date)}</td><td>{row.type}</td><td title={row.fullReference || row.reference}>{row.reference}</td><td>{row.party}</td><td>{row.details || '—'}</td><td>{row.income ? money(row.income) : '—'}</td><td>{row.outgoing ? money(row.outgoing) : '—'}</td>
                    </tr>
                  )) : <tr><td colSpan="7">No transactions in this date range.</td></tr>}
                </tbody>
                <tfoot><tr><th colSpan="5">Totals</th><th>{money(reportReceived)}</th><th>{money(reportOutgoings)}</th></tr></tfoot>
              </table>
            </div>
          </>
        ) : (
          <p>Choose a date range and generate a report.</p>
        )}
      </section>
      <section style={panel}>
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0 }}>Monthly financial overview</h3>
            <p style={{ margin: '6px 0 0', color: '#65736c' }}>
              Showing {overviewMonthLabel(overviewMonth)} · compared with {overviewMonthLabel(previousOverviewMonth)}
            </p>
          </div>
          <label style={{ display: 'grid', gap: 6, minWidth: 170 }}>
            Month
            <input
              aria-label="Overview month"
              type="month"
              value={overviewMonth}
              max={localDateKey(new Date()).slice(0, 7)}
              onChange={(event) => setOverviewMonth(event.target.value)}
            />
          </label>
        </header>
        <div className="stats-grid">
          <article className="stat-card">
            <span>Delivered package value</span>
            <strong>{money(overviewTotals.deliveredValue)}</strong>
            <small>{overviewComparison(overviewTotals.deliveredValue, previousOverviewTotals.deliveredValue)}</small>
          </article>
          <article className="stat-card">
            <span>Estimated driver shares</span>
            <strong>{overviewTotals.estimatedDriverShares === null ? '—' : money(overviewTotals.estimatedDriverShares)}</strong>
            <small>{overviewTotals.estimatedDriverShares === null ? (overviewDriverRatesError || 'Waiting for driver share rates.') : overviewComparison(overviewTotals.estimatedDriverShares, previousOverviewTotals.estimatedDriverShares)}</small>
          </article>
          <article className="stat-card">
            <span>Recorded business expenses</span>
            <strong>{money(overviewTotals.recordedExpenses)}</strong>
            <small>{overviewComparison(overviewTotals.recordedExpenses, previousOverviewTotals.recordedExpenses)}</small>
          </article>
          <article className="stat-card">
            <span>Estimated operating result</span>
            <strong>{overviewTotals.estimatedOperatingResult === null ? '—' : money(overviewTotals.estimatedOperatingResult)}</strong>
            <small>{overviewTotals.estimatedOperatingResult === null ? 'Unavailable until driver shares load.' : overviewComparison(overviewTotals.estimatedOperatingResult, previousOverviewTotals.estimatedOperatingResult)}</small>
          </article>
          <article className="stat-card">
            <span>Outstanding invoices</span>
            <strong>{money(overviewTotals.outstandingInvoices)}</strong>
            <small>{overviewComparison(overviewTotals.outstandingInvoices, previousOverviewTotals.outstandingInvoices)}</small>
          </article>
          <article className="stat-card">
            <span>Payments confirmed</span>
            <strong>{money(overviewTotals.payments)}</strong>
            <small>{overviewComparison(overviewTotals.payments, previousOverviewTotals.payments)}</small>
          </article>
          <article className="stat-card">
            <span>Net after driver withdrawals</span>
            <strong>{money(overviewTotals.netAfterWithdrawals)}</strong>
            <small>{overviewComparison(overviewTotals.netAfterWithdrawals, previousOverviewTotals.netAfterWithdrawals)}</small>
          </article>
        </div>
        <p style={{ margin: '10px 0 0', color: '#65736c', fontSize: 13 }}>
          Estimated operating result = delivered fees earned − estimated driver shares − recorded business expenses. Expenses are recorded when paid, so unpaid expenses and other costs may be missing; this is not a finalized accounting profit and loss statement.
        </p>
      </section>

      <section style={panel}>
        <h3>Recorded driver outgoings</h3>
        <p>Paid withdrawals · Total out: {money(withdrawalRequests.filter((request) => request.status === 'paid').reduce((sum, request) => sum + Number(request.amount || 0), 0))}</p>
        {withdrawalRequests.some((request) => request.status === 'paid') ? (
          withdrawalRequests.filter((request) => request.status === 'paid').map((request) => (
            <article className="application-card" key={'out-' + request.id} style={{ padding: 14, marginBottom: 10 }}>
              <strong>{request.driver} · {money(request.amount)}</strong>
              <p><span title={request.id}>{shortWithdrawalRequestId(request.id)}</span> · Paid {new Date(request.paid_at || request.reviewedAt || request.requestedAt).toLocaleString()}</p>
              <p>{request.bankDetails?.bankName || 'Bank not recorded'} · {request.bankDetails?.accountHolder || 'Account name missing'} · {request.bankDetails?.accountNumber || 'Account number missing'}{request.bankDetails?.branch ? ' · ' + request.bankDetails.branch : ''}</p>
            </article>
          ))
        ) : (
          <p>No approved driver withdrawals recorded.</p>
        )}
      </section>

      <section style={panel}>
        <h3>Payment account settings</h3>
        <p>
          Shown to partners on unpaid invoices. {liveMode ? 'Saved in the database.' : 'Saved in this demo workspace.'}
        </p>
        <label>
          Account name
          <input
            value={billing.transferAccountName || ''}
            onChange={(e) =>
              setBilling((current) => ({
                ...current,
                transferAccountName: e.target.value,
              }))
            }
          />
        </label>
        <label>
          Account number
          <input
            value={billing.transferAccountNumber || ''}
            onChange={(e) =>
              setBilling((current) => ({
                ...current,
                transferAccountNumber: e.target.value,
              }))
            }
          />
        </label>
        <button style={buttonStyle} type="button" onClick={persistPaymentAccount}>
          Save payment account
        </button>
      </section>
      </>
      )}
      {liveMode && databaseFinanceError && <p role="alert" className="notice">{databaseFinanceError}</p>}
      {notice && workspace !== 'Partner' && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
    </section>
  );
}
