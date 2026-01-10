document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = window.API_CONFIG?.BASE_URL || '';
  const BUSINESS_PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
  const IMAGE_MESSAGE_MAX_BYTES = 5 * 1024 * 1024;
  const AUDIO_MESSAGE_MAX_BYTES = 16 * 1024 * 1024;
  const REALTIME_POLL_MS = 8000;
  const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
  const IMAGE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png']);
  const DOCUMENT_MIME_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/json',
    'application/xml',
    'application/csv',
    'application/zip',
    'application/x-zip-compressed',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'application/vnd.rar',
    'text/plain',
    'text/csv',
    'text/xml',
  ]);
  const DOCUMENT_EXTENSIONS = new Set([
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.txt',
    '.csv',
    '.xml',
    '.json',
    '.zip',
    '.7z',
    '.rar',
  ]);
  const EMOJI_RECENTS_KEY = 'web_whatsapp_recent_emojis';
  const EMOJI_CATEGORIES = [
    { key: 'recent', label: 'Recentes', iconClass: 'fas fa-clock', search: 'recentes historico recent' },
    {
      key: 'smileys',
      label: 'Smileys e pessoas',
      iconClass: 'far fa-smile',
      search: 'sorriso rosto feliz pessoa smile happy face',
    },
    {
      key: 'animals',
      label: 'Animais e natureza',
      iconClass: 'fas fa-paw',
      search: 'animal natureza pet cachorro gato animal nature',
    },
    {
      key: 'food',
      label: 'Comidas e bebidas',
      iconClass: 'fas fa-burger',
      search: 'comida bebida restaurante cafe food drink',
    },
    {
      key: 'activities',
      label: 'Atividades',
      iconClass: 'fas fa-futbol',
      search: 'atividade esporte jogo musica activity sport',
    },
    { key: 'travel', label: 'Viagem e lugares', iconClass: 'fas fa-plane', search: 'viagem lugar cidade praia travel place' },
    {
      key: 'objects',
      label: 'Objetos',
      iconClass: 'fas fa-lightbulb',
      search: 'objeto ferramenta tecnologia object tool',
    },
    { key: 'symbols', label: 'Simbolos', iconClass: 'fas fa-hashtag', search: 'simbolo coracao alerta symbol heart' },
    { key: 'flags', label: 'Bandeiras', iconClass: 'fas fa-flag', search: 'bandeira pais flag country' },
  ];
  const EMOJI_CATEGORY_LOOKUP = EMOJI_CATEGORIES.reduce((acc, item) => {
    acc[item.key] = item;
    return acc;
  }, {});
  const EMOJI_MAP = {
    smileys: [
      '😀',
      '😃',
      '😄',
      '😁',
      '😆',
      '😅',
      '😂',
      '🤣',
      '😊',
      '😇',
      '🙂',
      '🙃',
      '😉',
      '😌',
      '😍',
      '🥰',
      '😘',
      '😗',
      '😙',
      '😚',
      '😋',
      '😛',
      '😝',
      '😜',
      '🤪',
      '🤨',
      '🧐',
      '🤓',
      '😎',
      '🥸',
      '🤩',
      '😏',
      '😒',
      '😞',
      '😔',
      '😟',
      '😕',
      '🙁',
      '☹️',
      '😣',
      '😖',
      '😫',
      '😩',
      '🥺',
      '😢',
      '😭',
      '😤',
      '😠',
      '😡',
      '🤬',
      '😳',
      '🥵',
      '🥶',
      '😱',
      '😨',
      '😰',
      '😥',
      '😓',
      '🤗',
      '🤔',
      '🫡',
      '🤭',
      '🤫',
      '🤥',
      '😶',
      '😶‍🌫️',
      '😐',
      '😑',
      '😬',
      '🙄',
      '😯',
      '😦',
      '😧',
      '😮',
      '😲',
      '🥱',
      '😴',
      '🤤',
      '😪',
      '😵',
      '🤐',
      '🥴',
      '🤢',
      '🤮',
      '🤧',
      '😷',
      '🤒',
      '🤕',
    ],
    animals: [
      '🐶',
      '🐱',
      '🐭',
      '🐹',
      '🐰',
      '🦊',
      '🐻',
      '🐼',
      '🐨',
      '🐯',
      '🦁',
      '🐮',
      '🐷',
      '🐽',
      '🐸',
      '🐵',
      '🙈',
      '🙉',
      '🙊',
      '🐒',
      '🐔',
      '🐧',
      '🐦',
      '🐤',
      '🐣',
      '🦆',
      '🦅',
      '🦉',
      '🦇',
      '🐺',
      '🐗',
      '🐴',
      '🦄',
      '🐝',
      '🐛',
      '🦋',
      '🐌',
      '🐞',
      '🐜',
      '🪲',
      '🐢',
      '🐍',
      '🦎',
      '🐙',
      '🦑',
      '🦀',
      '🐡',
      '🐠',
      '🐟',
      '🐬',
      '🐳',
      '🐋',
      '🦈',
      '🐊',
      '🐅',
      '🐆',
      '🦓',
      '🦍',
      '🦧',
      '🐘',
      '🦛',
      '🦏',
      '🐪',
      '🐫',
      '🦒',
      '🦘',
      '🦬',
      '🦙',
      '🐃',
      '🐂',
      '🐄',
      '🐎',
      '🐖',
      '🐏',
      '🐑',
      '🦌',
      '🐕',
      '🐩',
      '🦮',
      '🐕‍🦺',
      '🐈',
      '🐈‍⬛',
      '🐓',
      '🦃',
      '🦚',
      '🦜',
      '🦢',
      '🕊️',
      '🐇',
      '🦝',
      '🦨',
      '🦡',
      '🦦',
      '🦥',
      '🐁',
      '🐀',
      '🐿️',
      '🦔',
    ],
    food: [
      '🍏',
      '🍎',
      '🍐',
      '🍊',
      '🍋',
      '🍌',
      '🍉',
      '🍇',
      '🍓',
      '🫐',
      '🍈',
      '🍒',
      '🍑',
      '🥭',
      '🍍',
      '🥥',
      '🥝',
      '🍅',
      '🍆',
      '🥑',
      '🥦',
      '🥬',
      '🥒',
      '🌶️',
      '🫑',
      '🥕',
      '🧄',
      '🧅',
      '🥔',
      '🍠',
      '🥐',
      '🥖',
      '🍞',
      '🥨',
      '🥯',
      '🥞',
      '🧇',
      '🧀',
      '🍖',
      '🍗',
      '🥩',
      '🥓',
      '🍔',
      '🍟',
      '🍕',
      '🌭',
      '🥪',
      '🥙',
      '🧆',
      '🌮',
      '🌯',
      '🥗',
      '🍝',
      '🍜',
      '🍲',
      '🍛',
      '🍣',
      '🍱',
      '🥟',
      '🥠',
      '🍤',
      '🍦',
      '🍧',
      '🍨',
      '🍩',
      '🍪',
      '🎂',
      '🍰',
      '🧁',
      '🍫',
      '🍬',
      '🍭',
      '🍮',
      '🍯',
      '☕',
      '🍵',
      '🧃',
      '🥤',
      '🧋',
      '🍺',
      '🍻',
      '🥂',
      '🍷',
      '🍸',
      '🍹',
      '🍾',
    ],
    activities: [
      '⚽',
      '🏀',
      '🏈',
      '⚾',
      '🥎',
      '🎾',
      '🏐',
      '🏉',
      '🥏',
      '🎱',
      '🏓',
      '🏸',
      '🥍',
      '🏒',
      '🏑',
      '🥊',
      '🥋',
      '🎯',
      '🎳',
      '🪁',
      '🎮',
      '🎲',
      '🧩',
      '🧸',
      '🪀',
      '🎨',
      '🎭',
      '🎤',
      '🎧',
      '🎼',
      '🎹',
      '🎷',
      '🎺',
      '🎸',
      '🪕',
      '🥁',
      '🪘',
      '🪇',
      '🏆',
      '🥇',
      '🥈',
      '🥉',
      '🏅',
      '🎖️',
      '🏃',
      '🚴',
      '🏋️',
      '🤸',
      '🤽',
      '🏊',
      '🧘',
      '🎣',
      '🎿',
      '⛷️',
      '🏂',
      '🏄',
      '🚣',
      '🚵',
      '🏇',
    ],
    travel: [
      '🚗',
      '🚕',
      '🚙',
      '🚌',
      '🚎',
      '🚓',
      '🚑',
      '🚒',
      '🚐',
      '🚚',
      '🚛',
      '🚜',
      '🏎️',
      '🚲',
      '🛴',
      '🛵',
      '🏍️',
      '🛺',
      '🚨',
      '🚔',
      '🚍',
      '🚘',
      '🚖',
      '🚡',
      '🚠',
      '🚟',
      '🚃',
      '🚋',
      '🚞',
      '🚝',
      '🚄',
      '🚅',
      '🚈',
      '🚇',
      '🚊',
      '🚉',
      '✈️',
      '🛫',
      '🛬',
      '🛩️',
      '🚀',
      '🛸',
      '🛥️',
      '🚤',
      '⛵',
      '🛶',
      '🚢',
      '🛳️',
      '⛴️',
      '🗽',
      '🗼',
      '🗿',
      '🏰',
      '🏯',
      '🏟️',
      '🏛️',
      '🏗️',
      '🧱',
      '🏠',
      '🏡',
      '🏘️',
      '🏚️',
      '🏢',
      '🏬',
      '🏭',
      '🏪',
      '🏫',
      '🏩',
      '🏨',
      '🏥',
      '⛲',
      '⛺',
      '🏕️',
      '🏖️',
      '🏝️',
      '🏜️',
      '🏞️',
      '🗻',
      '⛰️',
      '🌋',
      '🏔️',
      '🌅',
      '🌄',
      '🌆',
      '🌇',
      '🌃',
      '🌉',
      '🌌',
    ],
    objects: [
      '⌚',
      '📱',
      '📲',
      '💻',
      '🖥️',
      '🖨️',
      '🖱️',
      '🖲️',
      '💽',
      '💾',
      '💿',
      '📀',
      '📷',
      '📸',
      '🎥',
      '📹',
      '📺',
      '📻',
      '🎙️',
      '🎚️',
      '🎛️',
      '⏱️',
      '⏲️',
      '📡',
      '🔋',
      '🔌',
      '💡',
      '🔦',
      '🕯️',
      '🧯',
      '🛢️',
      '💸',
      '💵',
      '💶',
      '💷',
      '💳',
      '💎',
      '⚖️',
      '🔧',
      '🪛',
      '🔨',
      '🪓',
      '⛏️',
      '🛠️',
      '🧰',
      '🧲',
      '🧪',
      '🧫',
      '🧬',
      '🩺',
      '💊',
      '💉',
      '🩹',
      '🩼',
      '🩸',
      '🚪',
      '🛏️',
      '🛋️',
      '🚽',
      '🚿',
      '🛁',
      '🧴',
      '🧷',
      '🧹',
      '🧺',
      '🧻',
      '🪣',
      '🧼',
      '🪥',
      '🪒',
      '🧽',
      '🪟',
      '📦',
      '📫',
      '📬',
      '📮',
      '🗳️',
      '✉️',
      '📧',
      '📥',
      '📤',
      '📪',
      '📁',
      '📂',
      '🗂️',
      '🗄️',
      '🗑️',
      '📝',
      '✏️',
      '🖊️',
      '🖋️',
      '🖌️',
      '🖍️',
      '📎',
      '📌',
      '📍',
      '🔍',
      '🔎',
      '🔒',
      '🔓',
      '🔑',
      '🔨',
    ],
    symbols: [
      '❤️',
      '🧡',
      '💛',
      '💚',
      '💙',
      '💜',
      '🖤',
      '🤍',
      '🤎',
      '💔',
      '❣️',
      '💕',
      '💞',
      '💓',
      '💗',
      '💖',
      '💘',
      '💝',
      '💟',
      '☮️',
      '✝️',
      '☪️',
      '🕉️',
      '☸️',
      '✡️',
      '🔯',
      '🕎',
      '☯️',
      '☢️',
      '☣️',
      '🆘',
      '✅',
      '☑️',
      '✔️',
      '❌',
      '✖️',
      '➕',
      '➖',
      '➗',
      '➰',
      '➿',
      '〽️',
      '‼️',
      '⁉️',
      '❗',
      '❓',
      '❔',
      '⚠️',
      '🔥',
      '💯',
      '💢',
      '💥',
      '💫',
      '💤',
      '💦',
      '💨',
      '🕳️',
      '✳️',
      '✴️',
      '❇️',
      '🆗',
      '🆙',
      '🆒',
      '🆕',
      '🆓',
      '♻️',
      '🔔',
      '🔕',
      '📣',
      '📢',
      '🔊',
      '🔉',
      '🔈',
      '🔇',
    ],
    flags: [
      '🇧🇷',
      '🇺🇸',
      '🇬🇧',
      '🇫🇷',
      '🇪🇸',
      '🇮🇹',
      '🇩🇪',
      '🇵🇹',
      '🇦🇷',
      '🇨🇱',
      '🇨🇴',
      '🇲🇽',
      '🇨🇦',
      '🇯🇵',
      '🇨🇳',
      '🇰🇷',
      '🇮🇳',
      '🇿🇦',
      '🇦🇺',
      '🇳🇿',
      '🇧🇪',
      '🇳🇱',
      '🇸🇪',
      '🇳🇴',
      '🇩🇰',
      '🇫🇮',
      '🇨🇭',
      '🇦🇹',
      '🇮🇪',
      '🇵🇱',
      '🇹🇷',
      '🇺🇦',
      '🇮🇱',
      '🇸🇦',
      '🇦🇪',
      '🇶🇦',
    ],
  };
  const EMOJI_LIBRARY = Object.entries(EMOJI_MAP).flatMap(([category, emojis]) => {
    const meta = EMOJI_CATEGORY_LOOKUP[category];
    const baseSearch = meta ? `${meta.label} ${meta.search}` : '';
    return emojis.map((emoji) => ({
      emoji,
      category,
      search: `${baseSearch} ${emoji}`.toLowerCase(),
    }));
  });
  const EMOJI_INDEX = new Map(EMOJI_LIBRARY.map((entry) => [entry.emoji, entry]));

  const elements = {
    input: document.getElementById('web-whatsapp-input'),
    sendButton: document.getElementById('web-whatsapp-send'),
    audioInput: document.getElementById('web-whatsapp-audio-input'),
    mediaInput: document.getElementById('web-whatsapp-media-input'),
    documentInput: document.getElementById('web-whatsapp-document-input'),
    inputWrap: document.getElementById('web-whatsapp-input-wrap'),
    recordingBar: document.getElementById('web-whatsapp-recording-bar'),
    recordingTime: document.getElementById('web-whatsapp-recording-time'),
    recordingDot: document.getElementById('web-whatsapp-recording-dot'),
    recordingWave: document.getElementById('web-whatsapp-recording-wave'),
    recordingCancel: document.getElementById('web-whatsapp-recording-cancel'),
    recordingToggle: document.getElementById('web-whatsapp-recording-toggle'),
    recordingPlay: document.getElementById('web-whatsapp-recording-play'),
    attachButton: document.getElementById('web-whatsapp-attach'),
    emojiButton: document.getElementById('web-whatsapp-emoji'),
    messages: document.getElementById('web-whatsapp-messages'),
    companySelect: document.getElementById('web-whatsapp-company-select'),
    numberSelect: document.getElementById('web-whatsapp-number-select'),
    conversations: document.getElementById('web-whatsapp-conversations'),
    conversationsEmpty: document.getElementById('web-whatsapp-conversations-empty'),
    searchInput: document.getElementById('web-whatsapp-search'),
    chatPanel: document.getElementById('web-whatsapp-chat-panel'),
    dropzone: document.getElementById('web-whatsapp-dropzone'),
    chatName: document.getElementById('web-whatsapp-chat-name'),
    chatTags: document.getElementById('web-whatsapp-chat-tags'),
    chatStatus: document.getElementById('web-whatsapp-chat-status'),
    chatAvatar: document.getElementById('web-whatsapp-chat-avatar'),
    chatHeader: document.getElementById('web-whatsapp-chat-header'),
    chatFooter: document.getElementById('web-whatsapp-chat-footer'),
    chatMenuButton: document.getElementById('web-whatsapp-chat-menu'),
    myProfileButton: document.getElementById('web-whatsapp-my-profile'),
    newConversationButton: document.getElementById('web-whatsapp-new-conversation'),
    connectionBadge: document.getElementById('web-whatsapp-connection-badge'),
    petsModal: document.getElementById('web-whatsapp-pets-modal'),
    petsModalClose: document.getElementById('web-whatsapp-pets-close'),
    petsModalTitle: document.getElementById('web-whatsapp-pets-title'),
    petsModalList: document.getElementById('web-whatsapp-pets-list'),
    petsModalEmpty: document.getElementById('web-whatsapp-pets-empty'),
    petsModalLoading: document.getElementById('web-whatsapp-pets-loading'),
    addressModal: document.getElementById('web-whatsapp-address-modal'),
    addressModalClose: document.getElementById('web-whatsapp-address-close'),
    addressModalTitle: document.getElementById('web-whatsapp-address-title'),
    addressModalList: document.getElementById('web-whatsapp-address-list'),
    addressModalEmpty: document.getElementById('web-whatsapp-address-empty'),
    addressModalLoading: document.getElementById('web-whatsapp-address-loading'),
    newConversationModal: document.getElementById('web-whatsapp-new-conversation-modal'),
    newConversationClose: document.getElementById('web-whatsapp-new-conversation-close'),
    newConversationSearch: document.getElementById('web-whatsapp-new-conversation-search'),
    newConversationList: document.getElementById('web-whatsapp-new-conversation-list'),
    newConversationEmpty: document.getElementById('web-whatsapp-new-conversation-empty'),
    newConversationLoading: document.getElementById('web-whatsapp-new-conversation-loading'),
    shareContactsModal: document.getElementById('web-whatsapp-share-contacts-modal'),
    shareContactsClose: document.getElementById('web-whatsapp-share-contacts-close'),
    shareContactsSearch: document.getElementById('web-whatsapp-share-contacts-search'),
    shareContactsList: document.getElementById('web-whatsapp-share-contacts-list'),
    shareContactsEmpty: document.getElementById('web-whatsapp-share-contacts-empty'),
    shareContactsLoading: document.getElementById('web-whatsapp-share-contacts-loading'),
    shareContactsFooter: document.getElementById('web-whatsapp-share-contacts-footer'),
    shareContactsCount: document.getElementById('web-whatsapp-share-contacts-count'),
    shareContactsSend: document.getElementById('web-whatsapp-share-contacts-send'),
    contactsModal: document.getElementById('web-whatsapp-contacts-modal'),
    contactsModalClose: document.getElementById('web-whatsapp-contacts-close'),
    contactsModalTitle: document.getElementById('web-whatsapp-contacts-title'),
    contactsModalList: document.getElementById('web-whatsapp-contacts-list'),
    contactsModalEmpty: document.getElementById('web-whatsapp-contacts-empty'),
    filePreviewModal: document.getElementById('web-whatsapp-file-preview-modal'),
    filePreviewClose: document.getElementById('web-whatsapp-file-preview-close'),
    filePreviewTitle: document.getElementById('web-whatsapp-file-preview-title'),
    filePreviewSubtitle: document.getElementById('web-whatsapp-file-preview-subtitle'),
    filePreviewContent: document.getElementById('web-whatsapp-file-preview-content'),
    filePreviewCaption: document.getElementById('web-whatsapp-file-preview-caption'),
    filePreviewList: document.getElementById('web-whatsapp-file-preview-list'),
    filePreviewAdd: document.getElementById('web-whatsapp-file-preview-add'),
    filePreviewSend: document.getElementById('web-whatsapp-file-preview-send'),
    profilePanel: document.getElementById('web-whatsapp-profile-panel'),
    profileClose: document.getElementById('web-whatsapp-profile-close'),
    profileAvatar: document.getElementById('web-whatsapp-profile-avatar'),
    profileName: document.getElementById('web-whatsapp-profile-name'),
    profilePhone: document.getElementById('web-whatsapp-profile-phone'),
    profileLastMessage: document.getElementById('web-whatsapp-profile-last-message'),
    profileLastActivity: document.getElementById('web-whatsapp-profile-last-activity'),
    profileBlockLabel: document.getElementById('web-whatsapp-profile-block-label'),
    deleteConversationButton: document.getElementById('web-whatsapp-delete-conversation'),
    businessProfilePanel: document.getElementById('web-whatsapp-business-profile-panel'),
    businessProfileClose: document.getElementById('web-whatsapp-business-close'),
    businessProfileEdit: document.getElementById('web-whatsapp-business-edit'),
    businessProfileActions: document.getElementById('web-whatsapp-business-actions'),
    businessProfileSave: document.getElementById('web-whatsapp-business-save'),
    businessProfileCancel: document.getElementById('web-whatsapp-business-cancel'),
    businessProfileAvatar: document.getElementById('web-whatsapp-business-avatar'),
    businessProfileAvatarInput: document.getElementById('web-whatsapp-business-avatar-input'),
    businessProfileName: document.getElementById('web-whatsapp-business-name'),
    businessProfileNumber: document.getElementById('web-whatsapp-business-number'),
    businessProfileAbout: document.getElementById('web-whatsapp-business-about'),
    businessProfileAddress: document.getElementById('web-whatsapp-business-address'),
    businessProfileDescription: document.getElementById('web-whatsapp-business-description'),
    businessProfileEmail: document.getElementById('web-whatsapp-business-email'),
    businessProfileWebsites: document.getElementById('web-whatsapp-business-websites'),
    businessProfileVertical: document.getElementById('web-whatsapp-business-vertical'),
  };

  const state = {
    companies: [],
    selectedCompanyId: '',
    selectedNumberId: '',
    selectedNumber: null,
    numbersByCompany: {},
    contacts: [],
    selectedContactId: '',
    messages: [],
    messageIds: new Set(),
    loadingContacts: false,
    loadingMessages: false,
    sending: false,
    searchTerm: '',
    businessProfile: null,
    businessProfileEditing: false,
    businessProfileLoading: false,
    recording: false,
    recordingDiscard: false,
    recordingPaused: false,
    recordingReady: false,
    mediaRecorder: null,
    mediaStream: null,
    recordedChunks: [],
    recordingMimeType: '',
    recordingBlob: null,
    recordingUrl: '',
    recordingAudio: null,
    recordingTimer: null,
    recordingElapsedMs: 0,
    recordingStartedAt: 0,
    audioContext: null,
    recordingAnalyser: null,
    recordingSource: null,
    playbackAnalyser: null,
    playbackSource: null,
    activeAudio: null,
    mediaCache: new Map(),
    waveBars: [],
    waveAnimationId: null,
    waveMode: '',
    emojiPopover: null,
    emojiPopoverData: null,
    emojiActiveCategory: 'recent',
    emojiSearch: '',
    emojiRecent: [],
    emojiPanelMode: 'emoji',
    emojiCleanup: null,
    attachPopover: null,
    attachCleanup: null,
    chatMenuPopover: null,
    chatMenuCleanup: null,
    customerLookupCache: new Map(),
    customerPetsCache: new Map(),
    customerAddressCache: new Map(),
    newConversationContacts: [],
    newConversationLoading: false,
    shareContacts: [],
    shareContactsLoading: false,
    shareContactsSelected: new Map(),
    shareContactsSending: false,
    contactsModalContacts: [],
    socketConnected: false,
    pollTimer: null,
    dragCounter: 0,
    documentSending: false,
    audioSending: false,
    filePreviewItems: [],
    filePreviewIndex: 0,
  };

  const notify = (message, type = 'info') => {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type, 3200);
    } else if (type === 'error') {
      alert(message);
    } else {
      console.log(message);
    }
  };

  let newConversationSearchTimer = null;
  let shareContactsSearchTimer = null;

  const getToken = () => {
    try {
      return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || '';
    } catch {
      return '';
    }
  };

  const authHeaders = (json = true) => {
    const token = getToken();
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const trimValue = (value) => (typeof value === 'string' ? value.trim() : '');

  const fetchMediaBlobUrl = async (mediaId) => {
    const id = trimValue(mediaId);
    if (!id || !API_BASE || !state.selectedCompanyId) return '';
    if (state.mediaCache.has(id)) return state.mediaCache.get(id) || '';

    const url = `${API_BASE}/integrations/whatsapp/${state.selectedCompanyId}/media/${id}`;
    const resp = await fetch(url, { headers: authHeaders(false) });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data?.message || 'Erro ao carregar a midia.');
    }
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    state.mediaCache.set(id, objectUrl);
    return objectUrl;
  };

  const storeMediaInR2 = async (mediaId) => {
    const id = trimValue(mediaId);
    if (!id || !API_BASE || !state.selectedCompanyId) return null;
    const url = `${API_BASE}/integrations/whatsapp/${state.selectedCompanyId}/media/${id}/store`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.message || 'Erro ao salvar midia no R2.');
    }
    return data?.media || null;
  };

  const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');

  const formatPhone = (value) => {
    const digits = digitsOnly(value);
    if (!digits) return '';
    if (digits.startsWith('55') && digits.length >= 12) {
      const country = digits.slice(0, 2);
      const area = digits.slice(2, 4);
      const rest = digits.slice(4);
      if (rest.length === 9) {
        return `+${country} ${area} ${rest.slice(0, 5)}-${rest.slice(5)}`;
      }
      if (rest.length === 8) {
        return `+${country} ${area} ${rest.slice(0, 4)}-${rest.slice(4)}`;
      }
    }
    if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
      const area = digits.slice(0, 2);
      const rest = digits.slice(2);
      if (rest.length === 9) {
        return `+55 ${area} ${rest.slice(0, 5)}-${rest.slice(5)}`;
      }
      if (rest.length === 8) {
        return `+55 ${area} ${rest.slice(0, 4)}-${rest.slice(4)}`;
      }
      return `+55 ${digits}`;
    }
    return `+${digits}`;
  };

  const getFileExtension = (fileName) => {
    const name = trimValue(fileName);
    if (!name) return '';
    const index = name.lastIndexOf('.');
    if (index <= 0) return '';
    return name.slice(index).toLowerCase();
  };

  const isSupportedDocumentFile = (file) => {
    if (!file) return false;
    const mimeType = trimValue(file.type).toLowerCase();
    if (mimeType && DOCUMENT_MIME_TYPES.has(mimeType)) return true;
    const ext = getFileExtension(file.name);
    if (ext && DOCUMENT_EXTENSIONS.has(ext)) return true;
    return false;
  };

  const isSupportedImageFile = (file) => {
    if (!file) return false;
    const mimeType = trimValue(file.type).toLowerCase();
    if (mimeType && IMAGE_MIME_TYPES.has(mimeType)) return true;
    const ext = getFileExtension(file.name);
    if (ext && IMAGE_EXTENSIONS.has(ext)) return true;
    return false;
  };

  const setDropzoneActive = (active) => {
    if (!elements.dropzone) return;
    elements.dropzone.classList.toggle('hidden', !active);
    elements.dropzone.classList.toggle('flex', active);
  };

  const normalizePreviewFiles = (files) => {
    if (!files) return [];
    if (files instanceof File) return [files];
    if (Array.isArray(files)) return files.filter(Boolean);
    return Array.from(files).filter(Boolean);
  };

  const filterSupportedPreviewFiles = (files) => {
    const valid = [];
    let invalidCount = 0;
    files.forEach((file) => {
      if (isSupportedDocumentFile(file) || isSupportedImageFile(file)) {
        valid.push(file);
      } else {
        invalidCount += 1;
      }
    });
    if (invalidCount) {
      notify('Alguns arquivos nao sao suportados.', 'warning');
    }
    return valid;
  };

  const createPreviewEntry = (file) => ({
    id: `${file.name || 'arquivo'}-${file.size || 0}-${file.lastModified || 0}`,
    file,
    url: URL.createObjectURL(file),
    caption: '',
  });

  const clearFilePreview = () => {
    state.filePreviewItems.forEach((entry) => {
      if (entry?.url) URL.revokeObjectURL(entry.url);
    });
    state.filePreviewItems = [];
    state.filePreviewIndex = 0;
    if (elements.filePreviewContent) {
      elements.filePreviewContent.innerHTML = '';
    }
    if (elements.filePreviewList) {
      elements.filePreviewList.innerHTML = '';
    }
  };

  const addFilePreviewEntries = (files, { replace = false } = {}) => {
    const normalized = filterSupportedPreviewFiles(normalizePreviewFiles(files));
    if (!normalized.length) return false;
    if (replace) clearFilePreview();
    const existingIds = new Set(state.filePreviewItems.map((entry) => entry.id));
    normalized.forEach((file) => {
      const entry = createPreviewEntry(file);
      if (existingIds.has(entry.id)) return;
      state.filePreviewItems.push(entry);
      existingIds.add(entry.id);
    });
    if (state.filePreviewIndex >= state.filePreviewItems.length) {
      state.filePreviewIndex = 0;
    }
    return true;
  };

  const renderFilePreviewList = () => {
    if (!elements.filePreviewList) return;
    elements.filePreviewList.innerHTML = '';
    state.filePreviewItems.forEach((entry, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className =
        'relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-xl border border-primary/30 bg-dark text-white/70 hover:border-primary hover:text-white transition';
      if (index === state.filePreviewIndex) {
        button.classList.add('ring-2', 'ring-primary/50', 'border-primary');
      }

      const file = entry.file;
      const ext = getFileExtension(file.name || '');
      const isImage = isSupportedImageFile(file);
      const isPdf = file.type === 'application/pdf' || ext === '.pdf';

      if (isImage) {
        const image = document.createElement('img');
        image.src = entry.url;
        image.alt = file.name || 'Imagem';
        image.className = 'h-full w-full object-cover';
        button.appendChild(image);
      } else {
        const icon = document.createElement('i');
        icon.className = isPdf ? 'fas fa-file-pdf text-sm' : 'fas fa-file text-sm';
        button.appendChild(icon);
      }

      button.addEventListener('click', () => {
        state.filePreviewIndex = index;
        renderFilePreview();
      });
      elements.filePreviewList.appendChild(button);
    });
  };

  const renderFilePreview = () => {
    if (!elements.filePreviewContent || !elements.filePreviewTitle || !elements.filePreviewSubtitle) return;
    const entry = state.filePreviewItems[state.filePreviewIndex];
    if (!entry) return;
    const file = entry.file;

    const name = file.name || 'Arquivo';
    elements.filePreviewTitle.textContent = name;
    const metaParts = [];
    if (file.type) metaParts.push(file.type);
    const size = formatFileSize(file.size || 0);
    if (size) metaParts.push(size);
    elements.filePreviewSubtitle.textContent = metaParts.join(' - ') || 'Arquivo';

    elements.filePreviewContent.innerHTML = '';
    if (elements.filePreviewCaption) {
      elements.filePreviewCaption.value = entry.caption || '';
    }
    const previewUrl = entry.url;
    const ext = getFileExtension(name);
    const isPdf = file.type === 'application/pdf' || ext === '.pdf';
    const isImage = isSupportedImageFile(file);

    if (isPdf) {
      const frame = document.createElement('iframe');
      frame.src = previewUrl;
      frame.title = name;
      frame.className = 'h-full w-full rounded-xl bg-white';
      elements.filePreviewContent.appendChild(frame);
      renderFilePreviewList();
      return;
    }

    if (isImage) {
      const image = document.createElement('img');
      image.src = previewUrl;
      image.alt = name;
      image.className = 'max-h-full max-w-full rounded-xl object-contain bg-white';
      elements.filePreviewContent.appendChild(image);
      renderFilePreviewList();
      return;
    }

    const iconWrap = document.createElement('div');
    iconWrap.className = 'flex flex-col items-center gap-3 text-white/70';
    const icon = document.createElement('div');
    icon.className = 'h-14 w-14 rounded-2xl bg-white/10 flex items-center justify-center text-2xl';
    icon.innerHTML = '<i class="fas fa-file"></i>';
    const label = document.createElement('p');
    label.className = 'text-sm font-semibold';
    label.textContent = ext ? ext.replace('.', '').toUpperCase() : 'Arquivo';
    iconWrap.appendChild(icon);
    iconWrap.appendChild(label);
    elements.filePreviewContent.appendChild(iconWrap);
    renderFilePreviewList();
  };

  const createPendingDocumentMessage = (entry) => {
    const file = entry?.file;
    const caption = trimValue(entry?.caption || '');
    const label = caption || file?.name || '[documento]';
    const createdAt = entry?.createdAt || new Date().toISOString();
    return {
      id: '',
      clientId: entry?.clientId || '',
      direction: 'outgoing',
      status: 'Enviando',
      message: label,
      origin: '',
      destination: entry?.destination || state.selectedContactId,
      messageId: '',
      createdAt,
      media: {
        type: 'document',
        direction: 'outgoing',
        filename: file?.name || 'documento',
        mimeType: file?.type || '',
        caption,
      },
    };
  };

  const createPendingImageMessage = (entry) => {
    const file = entry?.file;
    const caption = trimValue(entry?.caption || '');
    const label = caption || '[imagem]';
    const createdAt = entry?.createdAt || new Date().toISOString();
    return {
      id: '',
      clientId: entry?.clientId || '',
      direction: 'outgoing',
      status: 'Enviando',
      message: label,
      origin: '',
      destination: entry?.destination || state.selectedContactId,
      messageId: '',
      createdAt,
      media: {
        type: 'image',
        direction: 'outgoing',
        url: entry?.localUrl || entry?.url || '',
        filename: file?.name || 'imagem',
        mimeType: file?.type || '',
        caption,
      },
    };
  };

  const createPendingAudioMessage = (entry) => {
    const file = entry?.file;
    const label = entry?.label || '[audio]';
    const createdAt = entry?.createdAt || new Date().toISOString();
    return {
      id: '',
      clientId: entry?.clientId || '',
      direction: 'outgoing',
      status: 'Enviando',
      message: label,
      origin: '',
      destination: entry?.destination || state.selectedContactId,
      messageId: '',
      createdAt,
      media: {
        type: 'audio',
        direction: 'outgoing',
        url: entry?.localUrl || '',
        mimeType: file?.type || '',
      },
    };
  };

  const isFilePreviewOpen = () =>
    !!elements.filePreviewModal && !elements.filePreviewModal.classList.contains('hidden');

  const openFilePreview = (files, options = {}) => {
    const append = options.append === true;
    if (!files || (Array.isArray(files) && files.length === 0)) return;
    if (!state.selectedCompanyId || !state.selectedNumberId || !state.selectedContactId) {
      notify('Selecione um numero e uma conversa antes de enviar.', 'warning');
      return;
    }
    closeEmojiPopover();
    closeAttachPopover();
    closeChatMenuPopover();

    const added = addFilePreviewEntries(files, { replace: !append });
    if (!added) return;
    if (!append) {
      state.filePreviewIndex = 0;
      if (elements.filePreviewCaption) {
        elements.filePreviewCaption.value = '';
        elements.filePreviewCaption.focus();
      }
    }
    renderFilePreview();
    setDropzoneActive(false);
    setModalVisibility(elements.filePreviewModal, true);
  };

  const closeFilePreview = () => {
    setModalVisibility(elements.filePreviewModal, false);
    clearFilePreview();
    if (elements.filePreviewCaption) {
      elements.filePreviewCaption.value = '';
    }
  };

  const sendDocumentBatch = async (entries) => {
    const list = Array.isArray(entries) ? entries.filter((entry) => entry?.file) : [];
    if (!list.length) return false;
    if (state.documentSending) return false;
    state.documentSending = true;
    let sent = true;

    try {
      for (let index = 0; index < list.length; index += 1) {
        const entry = list[index];
        const fileCaption = trimValue(entry.caption || '');
        const isImage = isSupportedImageFile(entry.file);
        const result = isImage
          ? await sendImage(entry.file, fileCaption, {
              skipState: true,
              pendingId: entry.clientId,
              destination: entry.destination,
              phoneNumberId: entry.phoneNumberId,
              companyId: entry.companyId,
            })
          : await sendDocument(entry.file, fileCaption, {
              skipState: true,
              pendingId: entry.clientId,
              destination: entry.destination,
              phoneNumberId: entry.phoneNumberId,
              companyId: entry.companyId,
            });
        if (!result) sent = false;
      }
    } finally {
      state.documentSending = false;
    }

    return sent;
  };

  const sendFilePreview = async () => {
    if (!state.filePreviewItems.length) return;
    if (state.documentSending) {
      notify('Envio de anexos em andamento.', 'warning');
      return;
    }
    if (elements.filePreviewCaption) {
      const entry = state.filePreviewItems[state.filePreviewIndex];
      if (entry) {
        entry.caption = elements.filePreviewCaption.value || '';
      }
    }

    const now = Date.now();
    const queuedEntries = state.filePreviewItems.map((entry, index) => {
      const clientId = entry.clientId || `pending-doc-${now}-${index}-${Math.random().toString(16).slice(2, 8)}`;
      return {
        ...entry,
        clientId,
        companyId: state.selectedCompanyId,
        phoneNumberId: state.selectedNumberId,
        destination: state.selectedContactId,
        createdAt: entry.createdAt || new Date().toISOString(),
      };
    });

    queuedEntries.forEach((entry) => {
      const isImage = isSupportedImageFile(entry.file);
      let pendingMessage = null;
      if (isImage) {
        let localUrl = '';
        try {
          localUrl = URL.createObjectURL(entry.file);
        } catch (_) {
          localUrl = '';
        }
        pendingMessage = createPendingImageMessage({ ...entry, localUrl });
      } else {
        pendingMessage = createPendingDocumentMessage(entry);
      }
      state.messages.push(pendingMessage);
      updateConversationPreviewForContact(entry.destination, pendingMessage.message, pendingMessage.createdAt, {
        status: pendingMessage.status,
        messageId: pendingMessage.messageId,
        phoneNumberId: entry.phoneNumberId,
      });
    });
    renderMessages();

    closeFilePreview();
    void sendDocumentBatch(queuedEntries);
  };

  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const formatTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const formatFileSize = (bytes) => {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
  };

  const formatListTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    if (isSameDay(date, now)) {
      return formatTime(date);
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameDay(date, yesterday)) {
      return 'Ontem';
    }
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  const formatDayLabel = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    if (isSameDay(date, now)) return 'Hoje';
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameDay(date, yesterday)) return 'Ontem';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  const ensureAudioContext = () => {
    if (state.audioContext) return state.audioContext;
    const AudioContextRef = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextRef) return null;
    state.audioContext = new AudioContextRef();
    return state.audioContext;
  };

  const ensureWaveBars = () => {
    if (!elements.recordingWave || state.waveBars.length > 0) return;
    const barCount = 12;
    for (let i = 0; i < barCount; i += 1) {
      const bar = document.createElement('span');
      bar.style.display = 'block';
      bar.style.width = '4px';
      bar.style.height = '6px';
      bar.style.borderRadius = '999px';
      bar.style.background = 'var(--color-primary)';
      bar.style.opacity = '0.35';
      bar.style.transition = 'height 120ms ease, opacity 120ms ease';
      elements.recordingWave.appendChild(bar);
      state.waveBars.push(bar);
    }
  };

  const setWaveBarsIdle = () => {
    ensureWaveBars();
    state.waveBars.forEach((bar) => {
      bar.style.height = '6px';
      bar.style.opacity = '0.35';
    });
  };

  const stopWaveAnimation = (reset = true) => {
    if (state.waveAnimationId) {
      cancelAnimationFrame(state.waveAnimationId);
      state.waveAnimationId = null;
    }
    state.waveMode = '';
    if (reset) {
      setWaveBarsIdle();
    }
  };

  const startWaveAnimation = (analyser, mode) => {
    if (!analyser || !elements.recordingWave) return;
    ensureWaveBars();
    stopWaveAnimation(false);
    state.waveMode = mode;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const barCount = state.waveBars.length || 1;
    const step = Math.max(1, Math.floor(dataArray.length / barCount));
    const minHeight = 4;
    const maxHeight = 16;

    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      for (let i = 0; i < barCount; i += 1) {
        const value = dataArray[i * step] / 255;
        const height = Math.max(minHeight, Math.round(minHeight + value * (maxHeight - minHeight)));
        const opacity = 0.35 + value * 0.65;
        const bar = state.waveBars[i];
        if (!bar) continue;
        bar.style.height = `${height}px`;
        bar.style.opacity = opacity.toFixed(2);
      }
      state.waveAnimationId = requestAnimationFrame(tick);
    };

    tick();
  };

  const createMessageWaveBars = (container, color) => {
    if (!container) return [];
    const bars = [];
    const barCount = 14;
    for (let i = 0; i < barCount; i += 1) {
      const bar = document.createElement('span');
      bar.style.display = 'block';
      bar.style.width = '3px';
      bar.style.height = '6px';
      bar.style.borderRadius = '999px';
      bar.style.background = color;
      bar.style.opacity = '0.35';
      bar.style.transition = 'height 140ms ease, opacity 140ms ease';
      container.appendChild(bar);
      bars.push(bar);
    }
    return bars;
  };

  const setMessageWaveIdle = (bars) => {
    bars.forEach((bar) => {
      bar.style.height = '6px';
      bar.style.opacity = '0.35';
    });
  };

  const stopMessageWaveAnimation = (container, bars, reset = true) => {
    if (!container) return;
    if (container.__waveAnimationId) {
      cancelAnimationFrame(container.__waveAnimationId);
      container.__waveAnimationId = null;
    }
    if (reset && Array.isArray(bars)) {
      setMessageWaveIdle(bars);
    }
  };

  const startMessageWaveAnimation = (container, bars) => {
    if (!container || !Array.isArray(bars) || bars.length === 0) return;
    stopMessageWaveAnimation(container, bars, false);
    const minHeight = 4;
    const maxHeight = 16;
    let lastTick = 0;

    const tick = (timestamp) => {
      if (!lastTick || timestamp - lastTick > 120) {
        lastTick = timestamp;
        bars.forEach((bar) => {
          const value = 0.2 + Math.random() * 0.8;
          const height = Math.max(minHeight, Math.round(minHeight + value * (maxHeight - minHeight)));
          bar.style.height = `${height}px`;
          bar.style.opacity = (0.35 + value * 0.65).toFixed(2);
        });
      }
      container.__waveAnimationId = requestAnimationFrame(tick);
    };

    container.__waveAnimationId = requestAnimationFrame(tick);
  };

  const formatRecordingTime = (elapsedMs) => {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  const updateRecordingTime = () => {
    if (!elements.recordingTime) return;
    const now = state.recordingStartedAt ? Date.now() : 0;
    const elapsed = state.recordingElapsedMs + (now ? now - state.recordingStartedAt : 0);
    elements.recordingTime.textContent = formatRecordingTime(elapsed);
  };

  const normalizeStatus = (value) => trimValue(value).toLowerCase();

  const buildStatusTick = (status) => {
    const normalized = normalizeStatus(status);
    if (!normalized) return null;
    if (normalized === 'enviando') {
      return { icon: 'fa-circle-notch fa-spin', color: 'text-gray-400' };
    }
    if (normalized === 'enviado') {
      return { icon: 'fa-check', color: 'text-gray-400' };
    }
    if (normalized === 'entregue') {
      return { icon: 'fa-check-double', color: 'text-gray-400' };
    }
    if (normalized === 'lido' || normalized === 'visualizado') {
      return { icon: 'fa-check-double', color: 'text-blue-500' };
    }
    return null;
  };

  const normalizeUnreadCount = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
  };

  let socket = null;
  let socketPromise = null;
  let socketScriptPromise = null;
  let socketRoom = null;
  let realtimePollInFlight = false;

  const getServerBaseUrl = () => {
    let base = '';
    try {
      if (window.API_CONFIG?.SERVER_URL) {
        base = window.API_CONFIG.SERVER_URL;
      }
    } catch (_) {
      base = '';
    }

    if (!base && window.location?.origin) {
      base = window.location.origin;
    }

    return String(base || '').replace(/\/+$/, '');
  };

  const ensureSocketIoScript = () => {
    if (typeof window.io === 'function') {
      return Promise.resolve();
    }
    if (socketScriptPromise) return socketScriptPromise;
    const baseUrl = getServerBaseUrl();
    const src = baseUrl ? `${baseUrl}/socket.io/socket.io.js` : '/socket.io/socket.io.js';

    socketScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve();
      script.onerror = (event) => {
        console.error('Nao foi possivel carregar o Socket.IO.', event);
        socketScriptPromise = null;
        reject(new Error('socket-io-load-failed'));
      };
      document.head.appendChild(script);
    });

    return socketScriptPromise;
  };

  const addMessageId = (messageId) => {
    const normalized = trimValue(messageId);
    if (!normalized) return false;
    if (state.messageIds.has(normalized)) return false;
    state.messageIds.add(normalized);
    return true;
  };

  const rebuildMessageIds = () => {
    state.messageIds = new Set(
      state.messages.map((message) => trimValue(message.messageId)).filter(Boolean)
    );
  };

  const handleRealtimeMessage = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (String(payload.storeId || '') !== state.selectedCompanyId) return;
    if (String(payload.phoneNumberId || '') !== state.selectedNumberId) return;

    const direction = payload.direction || 'incoming';
    const contactId = digitsOnly(payload.waId || payload.origin || payload.destination || '');
    if (!contactId) return;
    const matchedContact = state.contacts.find((entry) => isPhoneMatch(entry.waId, contactId));
    const resolvedContactId = matchedContact?.waId || contactId;

    const createdAt = payload.createdAt || new Date().toISOString();
    const messageText = payload.message || '';
    const messageId = trimValue(payload.messageId);
    const clientId = trimValue(payload.clientId);

    if (direction === 'outgoing') {
      if (clientId) {
        const pending = state.messages.find((entry) => entry.clientId === clientId);
        if (pending) {
          pending.status = payload.status || pending.status || 'Enviado';
          if (messageText) pending.message = messageText;
          pending.createdAt = createdAt;
          if (payload.media) {
            pending.media = pending.media ? { ...pending.media, ...payload.media } : payload.media;
          }
          if (messageId) {
            pending.messageId = messageId;
            addMessageId(messageId);
          }
          updateConversationPreviewForContact(resolvedContactId, pending.message || messageText, pending.createdAt, {
            status: pending.status,
            messageId: pending.messageId,
            phoneNumberId: payload.phoneNumberId || state.selectedNumberId,
          });
          if (state.selectedContactId === resolvedContactId) {
            renderMessages();
          }
          return;
        }
      }
      let statusChanged = false;
      if (messageId) {
        const target = state.messages.find((entry) => entry.messageId === messageId);
        if (target && payload.status) {
          target.status = payload.status;
          renderMessages();
        }
        const statusContact = matchedContact
          || state.contacts.find((entry) => entry.lastMessageId && entry.lastMessageId === messageId);
        if (payload.status && statusContact) {
          statusChanged = applyContactStatus(statusContact, payload.status, messageId) || statusChanged;
        }
      }

      if (messageText && (!messageId || !state.messageIds.has(messageId))) {
        if (messageId) state.messageIds.add(messageId);
        if (matchedContact) {
          matchedContact.lastMessage = messageText;
          matchedContact.lastMessageAt = createdAt;
          matchedContact.lastDirection = 'outgoing';
          matchedContact.lastMessageId = messageId;
          if (payload.status) {
            matchedContact.lastStatus = payload.status;
          }
        } else {
          state.contacts.unshift({
            waId: resolvedContactId,
            name: payload.name || '',
            phoneNumberId: payload.phoneNumberId || state.selectedNumberId,
            lastMessage: messageText,
            lastMessageAt: createdAt,
            lastDirection: 'outgoing',
            lastMessageId: messageId,
            lastStatus: payload.status || '',
            unreadCount: 0,
            lastReadAt: null,
          });
        }

        state.contacts.sort((a, b) => {
          const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
          const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
          return bTime - aTime;
        });

        renderConversations();
        updateChatHeader();
        void hydrateContactIdentity(resolvedContactId, payload.name);

        if (state.selectedContactId === resolvedContactId) {
          state.messages.push(
            normalizeMessage({
              direction: 'outgoing',
              status: payload.status || 'Enviado',
              message: messageText,
              origin: payload.origin || '',
              destination: resolvedContactId,
              messageId,
              createdAt,
              media: payload.media || null,
              contacts: Array.isArray(payload.contacts) ? payload.contacts : null,
            })
          );
          renderMessages();
        }
      }
      if (statusChanged) {
        renderConversations();
        updateChatHeader();
      }
      return;
    }

    if (direction !== 'incoming') return;

    if (messageId && state.messageIds.has(messageId)) {
      return;
    }
    if (messageId) {
      state.messageIds.add(messageId);
    }

    const isActive = state.selectedContactId === resolvedContactId;
    if (matchedContact) {
      if (payload.name && !matchedContact.name) {
        matchedContact.name = payload.name;
      }
      matchedContact.lastMessage = messageText;
      matchedContact.lastMessageAt = createdAt;
      matchedContact.lastDirection = 'incoming';
      matchedContact.lastMessageId = messageId;
      if (isActive) {
        matchedContact.unreadCount = 0;
        matchedContact.lastReadAt = createdAt;
      } else {
        matchedContact.unreadCount = normalizeUnreadCount(matchedContact.unreadCount) + 1;
      }
    } else {
      state.contacts.unshift({
        waId: resolvedContactId,
        name: payload.name || '',
        phoneNumberId: payload.phoneNumberId || state.selectedNumberId,
        lastMessage: messageText,
        lastMessageAt: createdAt,
        lastDirection: 'incoming',
        lastMessageId: messageId,
        unreadCount: isActive ? 0 : 1,
        lastReadAt: isActive ? createdAt : null,
      });
    }

    state.contacts.sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bTime - aTime;
    });

    renderConversations();
    updateChatHeader();
    void hydrateContactIdentity(resolvedContactId, payload.name);

    if (state.selectedContactId === resolvedContactId) {
      state.messages.push(
        normalizeMessage({
          direction: 'incoming',
          status: payload.status || 'Recebido',
          message: messageText,
          origin: resolvedContactId,
          destination: payload.destination || '',
          messageId,
          createdAt,
          media: payload.media || null,
          contacts: Array.isArray(payload.contacts) ? payload.contacts : null,
        })
      );
      renderMessages();
      clearSelectedUnread(createdAt);
      void markConversationRead(messageId);
    }
  };

  const syncSocketRoom = () => {
    if (!socket || !socket.connected) return;
    const storeId = state.selectedCompanyId;
    const phoneNumberId = state.selectedNumberId;
    const nextRoom = storeId && phoneNumberId ? { storeId, phoneNumberId } : null;

    if (socketRoom && (!nextRoom || socketRoom.storeId !== nextRoom.storeId || socketRoom.phoneNumberId !== nextRoom.phoneNumberId)) {
      socket.emit('whatsapp:leave', socketRoom);
      socketRoom = null;
    }

    if (nextRoom && (!socketRoom || socketRoom.storeId !== nextRoom.storeId || socketRoom.phoneNumberId !== nextRoom.phoneNumberId)) {
      socket.emit('whatsapp:join', nextRoom);
      socketRoom = nextRoom;
    }
  };

  const runRealtimePoll = async () => {
    if (state.socketConnected) return;
    if (!API_BASE || !state.selectedCompanyId || !state.selectedNumberId) return;
    if (realtimePollInFlight || state.loadingContacts || state.loadingMessages) return;

    realtimePollInFlight = true;
    try {
      await loadConversations({ silent: true, skipMessages: true });
      if (state.selectedContactId) {
        await loadMessages({ silent: true });
      }
    } catch (error) {
      console.error('web-whatsapp:poll', error);
    } finally {
      realtimePollInFlight = false;
    }
  };

  const startRealtimePolling = () => {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(() => {
      void runRealtimePoll();
    }, REALTIME_POLL_MS);
    void runRealtimePoll();
  };

  const stopRealtimePolling = () => {
    if (!state.pollTimer) return;
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  };

  const setSocketConnected = (connected) => {
    const next = Boolean(connected);
    if (state.socketConnected === next) {
      if (!next && !state.pollTimer) {
        startRealtimePolling();
      }
      return;
    }
    state.socketConnected = next;
    if (next) {
      stopRealtimePolling();
    } else {
      startRealtimePolling();
    }
  };

  const ensureSocket = async () => {
    if (socket) return socket;
    if (!socketPromise) {
      socketPromise = ensureSocketIoScript()
        .then(() => {
          if (typeof window.io !== 'function') {
            throw new Error('Socket.IO indisponivel.');
          }
          const baseUrl = getServerBaseUrl();
          socket = window.io(baseUrl || undefined, {
            transports: ['websocket', 'polling'],
            autoConnect: true,
            reconnection: true,
          });

          setSocketConnected(socket.connected);

          socket.on('connect', () => {
            setSocketConnected(true);
            syncSocketRoom();
          });

          socket.on('reconnect', () => {
            setSocketConnected(true);
            syncSocketRoom();
          });

          socket.on('disconnect', () => {
            setSocketConnected(false);
          });

          socket.on('connect_error', () => {
            setSocketConnected(false);
          });

          socket.on('whatsapp:message', handleRealtimeMessage);
          return socket;
        })
        .catch((error) => {
          console.error('Falha ao conectar no Socket.IO do WhatsApp.', error);
          socketPromise = null;
          socket = null;
          setSocketConnected(false);
          return null;
        });
    }

    return socketPromise;
  };

  const readTracker = new Map();

  const buildReadKey = () => {
    if (!state.selectedCompanyId || !state.selectedNumberId || !state.selectedContactId) return '';
    return `${state.selectedCompanyId}:${state.selectedNumberId}:${state.selectedContactId}`;
  };

  const findLatestIncomingMessageId = () => {
    for (let i = state.messages.length - 1; i >= 0; i -= 1) {
      const entry = state.messages[i];
      if (entry?.direction === 'incoming' && entry.messageId) {
        return entry.messageId;
      }
    }
    return '';
  };

  const clearSelectedUnread = (timestamp) => {
    if (!state.selectedContactId) return false;
    const contact = state.contacts.find((entry) => entry.waId === state.selectedContactId);
    if (!contact) return false;
    const hadUnread = normalizeUnreadCount(contact.unreadCount) > 0;
    contact.unreadCount = 0;
    contact.lastReadAt = timestamp || new Date().toISOString();
    return hadUnread;
  };

  const markConversationRead = async (messageId) => {
    const normalizedId = trimValue(messageId);
    if (!API_BASE || !normalizedId) return;
    const key = buildReadKey();
    if (!key) return;
    if (readTracker.get(key) === normalizedId) return;
    readTracker.set(key, normalizedId);
    const cleared = clearSelectedUnread();
    if (cleared) {
      renderConversations();
    }

    try {
      await fetch(`${API_BASE}/integrations/whatsapp/${state.selectedCompanyId}/mark-read`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          phoneNumberId: state.selectedNumberId,
          messageId: normalizedId,
          waId: state.selectedContactId,
        }),
      });
    } catch (error) {
      console.error('web-whatsapp:read', error);
    }
  };

  const normalizeNumber = (number = {}) => ({
    id: number.id || number._id || '',
    displayName: number.displayName || '',
    phoneNumber: number.phoneNumber || '',
    phoneNumberId: number.phoneNumberId || '',
    status: number.status || '',
  });

  const normalizeConversation = (contact = {}) => ({
    waId: digitsOnly(contact.waId || contact.id || '') || '',
    name: contact.name || '',
    phoneNumberId: contact.phoneNumberId || '',
    lastMessage: contact.lastMessage || '',
    lastMessageAt: contact.lastMessageAt || null,
    lastDirection: contact.lastDirection || '',
    lastMessageId: contact.lastMessageId || '',
    lastStatus: contact.lastStatus || '',
    unreadCount: normalizeUnreadCount(contact.unreadCount),
    lastReadAt: contact.lastReadAt || null,
    isKnownUser: Boolean(contact.isKnownUser),
  });

  const normalizeMessage = (message = {}) => ({
    id: message.id || '',
    direction: message.direction || '',
    status: message.status || '',
    message: message.message || '',
    origin: message.origin || '',
    destination: message.destination || '',
    messageId: trimValue(message.messageId || ''),
    createdAt: message.createdAt || '',
    media: message.media || null,
    contacts: Array.isArray(message.contacts) ? message.contacts : null,
  });

  const setConnectionBadge = (status) => {
    if (!elements.connectionBadge) return;
    const badge = elements.connectionBadge;
    const indicator = badge.querySelector('i');
    const label = badge.querySelector('[data-status-text]');
    badge.classList.remove('bg-emerald-50', 'text-emerald-700', 'bg-amber-50', 'text-amber-700', 'bg-rose-50', 'text-rose-700');
    indicator?.classList.remove('text-emerald-600', 'text-amber-600', 'text-rose-600');

    if (status === 'Conectado') {
      badge.classList.add('bg-emerald-50', 'text-emerald-700');
      indicator?.classList.add('text-emerald-600');
      if (label) label.textContent = 'Conectado';
      return;
    }

    if (status === 'Pendente') {
      badge.classList.add('bg-amber-50', 'text-amber-700');
      indicator?.classList.add('text-amber-600');
      if (label) label.textContent = 'Pendente';
      return;
    }

    badge.classList.add('bg-rose-50', 'text-rose-700');
    indicator?.classList.add('text-rose-600');
    if (label) label.textContent = 'Desconectado';
  };

  const getContactLabel = (contact) => {
    const name = (contact?.name || '').trim();
    if (name) return name;
    if (contact?.waId) return formatPhone(contact.waId);
    return 'Contato';
  };

  const detachPlaybackAnalyser = () => {
    if (state.playbackSource) {
      try {
        state.playbackSource.disconnect();
      } catch (_) {
        // ignore
      }
    }
    state.playbackSource = null;
    state.playbackAnalyser = null;
  };

  const detachRecordingAnalyser = () => {
    if (state.recordingSource) {
      try {
        state.recordingSource.disconnect();
      } catch (_) {
        // ignore
      }
    }
    state.recordingSource = null;
    state.recordingAnalyser = null;
  };

  const attachRecordingAnalyser = (stream) => {
    const audioContext = ensureAudioContext();
    if (!audioContext) return null;
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => undefined);
    }
    detachRecordingAnalyser();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    state.recordingSource = source;
    state.recordingAnalyser = analyser;
    return analyser;
  };

  const attachPlaybackAnalyser = (audioEl) => {
    const audioContext = ensureAudioContext();
    if (!audioContext) return null;
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => undefined);
    }
    detachPlaybackAnalyser();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaElementSource(audioEl);
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    state.playbackSource = source;
    state.playbackAnalyser = analyser;
    return analyser;
  };

  const clearRecordingPlayback = () => {
    if (state.recordingAudio) {
      try {
        state.recordingAudio.pause();
      } catch (_) {
        // ignore
      }
    }
    if (state.recordingUrl) {
      URL.revokeObjectURL(state.recordingUrl);
    }
    detachPlaybackAnalyser();
    state.recordingAudio = null;
    state.recordingUrl = '';
  };

  const stopRecordingTimer = () => {
    if (state.recordingTimer) {
      clearInterval(state.recordingTimer);
      state.recordingTimer = null;
    }
    if (state.recordingStartedAt) {
      state.recordingElapsedMs += Date.now() - state.recordingStartedAt;
      state.recordingStartedAt = 0;
    }
    updateRecordingTime();
  };

  const startRecordingTimer = () => {
    if (state.recordingTimer) clearInterval(state.recordingTimer);
    state.recordingStartedAt = Date.now();
    state.recordingTimer = setInterval(updateRecordingTime, 500);
    updateRecordingTime();
  };

  const pauseRecordingTimer = () => {
    stopRecordingTimer();
  };

  const resumeRecordingTimer = () => {
    if (state.recordingTimer) clearInterval(state.recordingTimer);
    state.recordingStartedAt = Date.now();
    state.recordingTimer = setInterval(updateRecordingTime, 500);
    updateRecordingTime();
  };

  const resetRecordingState = () => {
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((track) => track.stop());
    }
    state.recording = false;
    state.recordingPaused = false;
    state.recordingReady = false;
    state.recordingDiscard = false;
    state.mediaRecorder = null;
    state.mediaStream = null;
    state.recordedChunks = [];
    state.recordingMimeType = '';
    state.recordingElapsedMs = 0;
    state.recordingStartedAt = 0;
    if (state.recordingTimer) {
      clearInterval(state.recordingTimer);
      state.recordingTimer = null;
    }
    state.recordingBlob = null;
    clearRecordingPlayback();
    stopWaveAnimation();
    detachRecordingAnalyser();
    updateRecordingTime();
    updateRecordingControls();
    setSendState();
  };

  const isRecordingPlaybackActive = () => Boolean(state.recordingAudio && !state.recordingAudio.paused);

  const loadEmojiRecents = () => {
    try {
      const data = JSON.parse(localStorage.getItem(EMOJI_RECENTS_KEY) || '[]');
      if (!Array.isArray(data)) return [];
      return data.filter((item) => typeof item === 'string' && item.trim()).slice(0, 24);
    } catch {
      return [];
    }
  };

  const saveEmojiRecents = (list) => {
    try {
      localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify(list));
    } catch {
      // ignore storage issues
    }
  };

  const addEmojiRecent = (emoji) => {
    if (!emoji) return;
    const next = [emoji, ...state.emojiRecent.filter((item) => item !== emoji)].slice(0, 24);
    state.emojiRecent = next;
    saveEmojiRecents(next);
  };

  const buildEmojiPopover = () => {
    const popover = document.createElement('div');
    popover.id = 'web-whatsapp-emoji-popover';
    popover.className =
      'fixed z-50 w-[320px] sm:w-[360px] rounded-2xl border border-gray-800 bg-gray-900 text-gray-100 shadow-2xl';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Selecao de emojis');

    const header = document.createElement('div');
    header.className = 'flex items-center gap-1 px-3 pt-3 pb-2 border-b border-gray-800';
    const tabs = new Map();
    EMOJI_CATEGORIES.forEach((category) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.dataset.emojiCategory = category.key;
      tab.setAttribute('aria-label', category.label);
      tab.setAttribute('title', category.label);
      tab.className =
        'h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-800/60 transition';
      const icon = document.createElement('i');
      icon.className = category.iconClass;
      tab.appendChild(icon);
      header.appendChild(tab);
      tabs.set(category.key, tab);
    });

    const searchWrap = document.createElement('div');
    searchWrap.className = 'px-3 pt-2 pb-3';
    const searchBox = document.createElement('div');
    searchBox.className = 'relative';
    const searchIcon = document.createElement('i');
    searchIcon.className =
      'fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.dataset.emojiSearch = 'true';
    searchInput.placeholder = 'Pesquisar emoji';
    searchInput.className =
      'w-full rounded-full border border-gray-700 bg-gray-800 py-2 pl-8 pr-3 text-xs text-gray-100 placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/30';
    searchBox.append(searchIcon, searchInput);
    searchWrap.appendChild(searchBox);

    const body = document.createElement('div');
    body.className = 'px-3 pb-3';
    const emojiContent = document.createElement('div');
    emojiContent.dataset.emojiContent = 'true';
    const titleRow = document.createElement('div');
    titleRow.className =
      'flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-400 font-semibold';
    const title = document.createElement('span');
    title.dataset.emojiTitle = 'true';
    title.textContent = 'Recentes';
    const count = document.createElement('span');
    count.dataset.emojiCount = 'true';
    count.className = 'text-[10px] text-gray-500';
    titleRow.append(title, count);

    const listWrap = document.createElement('div');
    listWrap.className = 'mt-2 max-h-72 overflow-y-auto pr-1 relative bg-primary/5';
    listWrap.style.minHeight = '18rem';
    const sections = new Map();
    EMOJI_CATEGORIES.forEach((category) => {
      const section = document.createElement('div');
      section.dataset.emojiSection = category.key;
      section.className = 'pt-2';
      const heading = document.createElement('div');
      heading.className = 'text-[11px] uppercase tracking-wide text-gray-400 font-semibold';
      heading.textContent = category.label;
      const grid = document.createElement('div');
      grid.className = 'text-lg';
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(8, minmax(0, 1fr))';
      grid.style.gap = '4px';
      grid.style.alignItems = 'center';
      grid.style.justifyItems = 'center';
      grid.style.width = '100%';
      grid.style.fontFamily = '"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji",sans-serif';
      grid.style.setProperty('font-variant-emoji', 'emoji');
      grid.dataset.emojiGrid = category.key;
      const empty = document.createElement('div');
      empty.dataset.emojiEmpty = category.key;
      empty.className = 'hidden text-xs text-gray-500 text-center py-2';
      empty.textContent = 'Nenhum emoji recente.';
      section.append(heading, grid, empty);
      listWrap.appendChild(section);
      sections.set(category.key, { section, heading, grid, empty });
    });

    const panelMessage = document.createElement('div');
    panelMessage.dataset.emojiPanelMessage = 'true';
    panelMessage.className =
      'hidden absolute inset-0 flex items-center justify-center text-xs text-primary text-center px-4';
    panelMessage.textContent = 'Em breve.';
    listWrap.appendChild(panelMessage);

    emojiContent.append(titleRow, listWrap);
    body.append(emojiContent);

    const footer = document.createElement('div');
    footer.className = 'flex justify-center border-t border-gray-800 px-3 py-2';
    const footerTabs = document.createElement('div');
    footerTabs.className =
      'inline-flex items-stretch rounded-full border border-gray-700 bg-gray-900/90 overflow-hidden';
    const panelButtons = new Map();
    const footerItems = [
      { key: 'emoji', label: '', iconClass: 'far fa-smile' },
      { key: 'gif', label: 'GIF' },
      { key: 'sticker', label: '', iconClass: 'fas fa-note-sticky' },
    ];
    footerItems.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.emojiPanel = item.key;
      button.className =
        'flex items-center gap-2 px-4 py-2 h-full text-[11px] font-semibold uppercase tracking-wide text-gray-400 hover:text-white hover:bg-gray-800 transition';
      if (index > 0) {
        button.classList.add('border-l', 'border-gray-700');
      }
      if (item.iconClass) {
        const icon = document.createElement('i');
        icon.className = item.iconClass;
        button.appendChild(icon);
      }
      if (item.label) {
        const label = document.createElement('span');
        label.textContent = item.label;
        button.appendChild(label);
      }
      footerTabs.appendChild(button);
      panelButtons.set(item.key, button);
    });
    footer.appendChild(footerTabs);

    popover.append(header, searchWrap, body, footer);

    return {
      popover,
      tabs,
      title,
      count,
      listWrap,
      sections,
      searchInput,
      emojiContent,
      panelMessage,
      panelButtons,
    };
  };

  const positionEmojiPopover = () => {
    if (!state.emojiPopover || !elements.emojiButton) return;
    const popover = state.emojiPopover;
    popover.style.visibility = 'hidden';
    popover.style.left = '0px';
    popover.style.top = '0px';
    const anchorRect = elements.emojiButton.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const spacing = 12;
    let top = anchorRect.top - popRect.height - spacing;
    if (top < spacing) {
      top = anchorRect.bottom + spacing;
    }
    let left = anchorRect.left + anchorRect.width / 2 - popRect.width / 2;
    if (left < spacing) left = spacing;
    if (left + popRect.width > window.innerWidth - spacing) {
      left = window.innerWidth - popRect.width - spacing;
    }
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.style.visibility = 'visible';
  };

  const getEmojiEntriesByCategory = (category, term) => {
    const searchTerm = (term || '').trim().toLowerCase();
    let entries = [];
    if (category === 'recent') {
      entries = state.emojiRecent
        .map((emoji) => EMOJI_INDEX.get(emoji) || { emoji, category: 'recent', search: '' })
        .filter(Boolean);
    } else {
      entries = EMOJI_LIBRARY.filter((entry) => entry.category === category);
    }
    if (!searchTerm) return entries;
    return entries.filter((entry) => entry.search.includes(searchTerm));
  };

  const updateEmojiTabStyles = () => {
    if (!state.emojiPopoverData) return;
    const { tabs } = state.emojiPopoverData;
    tabs.forEach((tab, key) => {
      const active = state.emojiPanelMode === 'emoji' && key === state.emojiActiveCategory;
      tab.classList.toggle('bg-gray-800', active);
      tab.classList.toggle('text-primary', active);
      tab.classList.toggle('text-gray-400', !active);
    });
  };

  const updateEmojiPanelTabs = () => {
    if (!state.emojiPopoverData) return;
    const { panelButtons } = state.emojiPopoverData;
    if (!panelButtons) return;
    panelButtons.forEach((button, key) => {
      const active = key === state.emojiPanelMode;
      button.classList.toggle('bg-gray-800', active);
      button.classList.toggle('text-white', active);
      button.classList.toggle('text-gray-400', !active);
    });
  };

  const updateEmojiTitle = () => {
    if (!state.emojiPopoverData) return;
    const { title, count } = state.emojiPopoverData;
    if (state.emojiPanelMode !== 'emoji') {
      title.textContent = state.emojiPanelMode === 'gif' ? 'GIF' : 'Figurinhas';
      if (count) count.textContent = '';
      return;
    }
    const term = state.emojiSearch.trim();
    if (term) {
      title.textContent = 'Resultados';
      if (count) {
        count.textContent = state.emojiPopoverData.totalMatches
          ? `${state.emojiPopoverData.totalMatches} emojis`
          : '';
      }
      return;
    }
    const meta = EMOJI_CATEGORY_LOOKUP[state.emojiActiveCategory];
    title.textContent = meta?.label || 'Emojis';
    if (count) {
      const total = state.emojiPopoverData.categoryCounts?.[state.emojiActiveCategory] || 0;
      count.textContent = total ? `${total} emojis` : '';
    }
  };

  const setEmojiActiveCategory = (category) => {
    if (!category || state.emojiActiveCategory === category) return;
    state.emojiActiveCategory = category;
    updateEmojiTabStyles();
    updateEmojiTitle();
  };

  const setEmojiPanelMode = (mode) => {
    if (!mode || state.emojiPanelMode === mode) return;
    state.emojiPanelMode = mode;
    updateEmojiPanelTabs();
    updateEmojiTabStyles();
    updateEmojiTitle();
  };

  const renderEmojiPopover = () => {
    if (!state.emojiPopoverData) return;
    const { listWrap, sections, searchInput, emojiContent, panelMessage } = state.emojiPopoverData;
    const term = state.emojiSearch.trim();
    if (state.emojiPanelMode !== 'emoji') {
      if (emojiContent) emojiContent.classList.remove('hidden');
      if (panelMessage) {
        panelMessage.classList.remove('hidden');
        panelMessage.textContent = state.emojiPanelMode === 'gif' ? 'GIFs em breve.' : 'Figurinhas em breve.';
      }
      sections.forEach((sectionInfo) => {
        sectionInfo.section.classList.add('hidden');
      });
      if (searchInput) {
        searchInput.disabled = true;
        searchInput.classList.add('opacity-60', 'cursor-not-allowed');
      }
      updateEmojiPanelTabs();
      updateEmojiTabStyles();
      updateEmojiTitle();
      return;
    }
    if (emojiContent) emojiContent.classList.remove('hidden');
    if (panelMessage) panelMessage.classList.add('hidden');
    if (searchInput) {
      searchInput.disabled = false;
      searchInput.classList.remove('opacity-60', 'cursor-not-allowed');
    }
    const previousScroll = listWrap?.scrollTop || 0;
    const categoryCounts = {};
    let totalMatches = 0;

    EMOJI_CATEGORIES.forEach((category) => {
      const sectionInfo = sections.get(category.key);
      if (!sectionInfo) return;
      const entries = getEmojiEntriesByCategory(category.key, term);
      categoryCounts[category.key] = entries.length;
      totalMatches += entries.length;
      sectionInfo.grid.innerHTML = '';
      entries.forEach((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.emoji = entry.emoji;
        button.className =
          'h-8 w-8 flex items-center justify-center rounded-lg text-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/40';
        button.style.width = '32px';
        button.style.height = '32px';
        button.style.display = 'flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.fontFamily =
          '"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji",sans-serif';
        button.style.setProperty('font-variant-emoji', 'emoji');
        button.textContent = entry.emoji;
        sectionInfo.grid.appendChild(button);
      });

      const showEmptyRecent = category.key === 'recent' && !term && entries.length === 0;
      sectionInfo.empty.classList.toggle('hidden', !showEmptyRecent);
      sectionInfo.section.classList.toggle('hidden', Boolean(term) && entries.length === 0);
    });

    if (!term && searchInput) {
      searchInput.value = '';
    }

    state.emojiPopoverData.categoryCounts = categoryCounts;
    state.emojiPopoverData.totalMatches = totalMatches;
    updateEmojiTabStyles();
    updateEmojiPanelTabs();
    updateEmojiTitle();
    if (listWrap) {
      listWrap.scrollTop = previousScroll;
    }
  };

  const closeEmojiPopover = () => {
    if (state.emojiCleanup) {
      state.emojiCleanup();
      state.emojiCleanup = null;
    }
    if (state.emojiPopover?.parentNode) {
      state.emojiPopover.parentNode.removeChild(state.emojiPopover);
    }
    state.emojiPopover = null;
    state.emojiPopoverData = null;
    state.emojiSearch = '';
  };

  const closeAttachPopover = () => {
    if (state.attachCleanup) {
      state.attachCleanup();
      state.attachCleanup = null;
    }
    if (state.attachPopover?.parentNode) {
      state.attachPopover.parentNode.removeChild(state.attachPopover);
    }
    state.attachPopover = null;
  };

  const closeChatMenuPopover = () => {
    if (state.chatMenuCleanup) {
      state.chatMenuCleanup();
      state.chatMenuCleanup = null;
    }
    if (state.chatMenuPopover?.parentNode) {
      state.chatMenuPopover.parentNode.removeChild(state.chatMenuPopover);
    }
    state.chatMenuPopover = null;
  };

  const buildAttachPopover = () => {
    const popover = document.createElement('div');
    popover.id = 'web-whatsapp-attach-popover';
    popover.className =
      'fixed z-50 w-52 rounded-2xl border border-gray-200 bg-white text-gray-700 shadow-xl';
    popover.setAttribute('role', 'menu');
    popover.setAttribute('aria-label', 'Enviar anexos');

    const list = document.createElement('div');
    list.className = 'flex flex-col gap-1 p-2';

    const options = [
      { key: 'document', label: 'Documento', icon: 'fas fa-file-lines' },
      { key: 'media', label: 'Fotos e Videos', icon: 'fas fa-photo-film' },
      { key: 'camera', label: 'Camera', icon: 'fas fa-camera' },
      { key: 'audio', label: 'Audio', icon: 'fas fa-microphone' },
      { key: 'contact', label: 'Contato', icon: 'fas fa-user' },
      { key: 'poll', label: 'Enquete', icon: 'fas fa-square-poll-vertical' },
      { key: 'event', label: 'Evento', icon: 'fas fa-calendar-days' },
    ];

    options.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.attachOption = item.key;
      button.className =
        'flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-primary/10 hover:text-primary transition';
      const icon = document.createElement('i');
      icon.className = item.icon;
      const label = document.createElement('span');
      label.textContent = item.label;
      button.append(icon, label);
      list.appendChild(button);
    });

    popover.appendChild(list);
    return popover;
  };

  const positionAttachPopover = () => {
    if (!state.attachPopover || !elements.attachButton) return;
    const popover = state.attachPopover;
    popover.style.visibility = 'hidden';
    popover.style.left = '0px';
    popover.style.top = '0px';
    const anchorRect = elements.attachButton.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const spacing = 12;
    let top = anchorRect.top - popRect.height - spacing;
    if (top < spacing) {
      top = anchorRect.bottom + spacing;
    }
    let left = anchorRect.left + anchorRect.width / 2 - popRect.width / 2;
    if (left < spacing) left = spacing;
    if (left + popRect.width > window.innerWidth - spacing) {
      left = window.innerWidth - popRect.width - spacing;
    }
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.style.visibility = 'visible';
  };

  const openAttachPopover = () => {
    if (!elements.attachButton || state.attachPopover) return;
    closeEmojiPopover();
    closeChatMenuPopover();
    const popover = buildAttachPopover();
    state.attachPopover = popover;
    document.body.appendChild(popover);
    positionAttachPopover();

    const handleOutsideClick = (event) => {
      if (popover.contains(event.target) || elements.attachButton.contains(event.target)) return;
      closeAttachPopover();
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeAttachPopover();
    };
    const handleResize = () => closeAttachPopover();
    const handleScroll = (event) => {
      if (event?.target && popover.contains(event.target)) return;
      closeAttachPopover();
    };

    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    state.attachCleanup = () => {
      document.removeEventListener('click', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };

    popover.addEventListener('click', (event) => {
      const option = event.target.closest('button[data-attach-option]');
      if (!option) return;
      const action = option.dataset.attachOption || '';
      closeAttachPopover();
      if (action === 'contact') {
        void openShareContactsModal();
        return;
      }
      if (action === 'document') {
        elements.documentInput?.click();
        return;
      }
      if (action === 'media' || action === 'camera') {
        elements.mediaInput?.click();
        return;
      }
    });
  };

  const toggleAttachPopover = () => {
    if (state.attachPopover) {
      closeAttachPopover();
    } else {
      openAttachPopover();
    }
  };

  const normalizePhoneCandidate = (value) => digitsOnly(value);

  const isPhoneMatch = (candidate, target) => {
    if (!candidate || !target) return false;
    if (candidate === target) return true;
    return candidate.endsWith(target) || target.endsWith(candidate);
  };

  const resolveCustomerByPhone = async (waId) => {
    const phone = digitsOnly(waId);
    if (!phone || !API_BASE) return null;
    if (state.customerLookupCache.has(phone)) {
      return state.customerLookupCache.get(phone) || null;
    }
    const lookupPhone = phone.length > 11 ? phone.slice(-11) : phone;
    const params = new URLSearchParams({ q: lookupPhone, limit: '5' });
    const resp = await fetch(`${API_BASE}/func/clientes/buscar?${params.toString()}`, { headers: authHeaders(false) });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data?.message || 'Nao foi possivel buscar o cliente.');
    }
    const list = await resp.json().catch(() => []);
    if (!Array.isArray(list) || list.length === 0) {
      state.customerLookupCache.set(phone, null);
      return null;
    }
    const match = list.find((entry) => {
      const candidatePhone = normalizePhoneCandidate(entry?.celular || entry?.telefone || entry?.phone || '');
      return isPhoneMatch(candidatePhone, phone) || isPhoneMatch(candidatePhone, lookupPhone);
    });
    const record = match || list[0];
    const customer = record?._id
      ? {
          id: String(record._id),
          name: record.nome || '',
          phone: normalizePhoneCandidate(record.celular || '') || phone,
          raw: record,
        }
      : null;
    state.customerLookupCache.set(phone, customer);
    return customer || null;
  };

  const formatCustomerName = (value) => {
    const raw = trimValue(value);
    if (!raw) return '';
    const parts = raw.split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).join(' ');
  };

  const hydrateContactIdentity = async (waId, fallbackName = '') => {
    const contactId = digitsOnly(waId);
    if (!contactId) return false;
    const contact = state.contacts.find((entry) => entry.waId === contactId);
    if (!contact) return false;

    let changed = false;
    const fallback = formatCustomerName(fallbackName);
    if (fallback && !contact.name) {
      contact.name = fallback;
      changed = true;
    }

    if (!contact.isKnownUser) {
      try {
        const customer = await resolveCustomerByPhone(contactId);
        if (customer) {
          const displayName = formatCustomerName(customer.name);
          if (displayName && contact.name !== displayName) {
            contact.name = displayName;
            changed = true;
          }
          if (!contact.isKnownUser) {
            contact.isKnownUser = true;
            changed = true;
          }
        }
      } catch (error) {
        console.error('web-whatsapp:customer-lookup', error);
      }
    }

    if (changed) {
      renderConversations();
      updateChatHeader();
      renderProfilePanel();
    }
    return changed;
  };

  const hasConversationContent = (contact, messages) => {
    if (!contact) return false;
    if (trimValue(contact.lastMessage)) return true;
    if (contact.lastMessageAt || contact.lastMessageId) return true;
    if (Array.isArray(messages) && messages.length > 0) return true;
    return false;
  };

  const cleanupEmptyConversation = (waId) => {
    const contactId = digitsOnly(waId);
    if (!contactId) return false;
    const contact = state.contacts.find((entry) => entry.waId === contactId);
    if (!contact) return false;
    const messages = state.selectedContactId === contactId ? state.messages : [];
    if (hasConversationContent(contact, messages)) return false;
    state.contacts = state.contacts.filter((entry) => entry.waId !== contactId);
    return true;
  };

  const setModalVisibility = (modal, visible) => {
    if (!modal) return;
    modal.classList.toggle('hidden', !visible);
    modal.classList.toggle('flex', visible);
  };

  const closePetsModal = () => {
    setModalVisibility(elements.petsModal, false);
  };

  const closeAddressModal = () => {
    setModalVisibility(elements.addressModal, false);
  };

  const closeCustomerModals = () => {
    closePetsModal();
    closeAddressModal();
  };

  const normalizeNewConversationContact = (contact = {}) => {
    const waId = digitsOnly(contact.waId || contact.phone || contact.celular || '');
    if (!waId) return null;
    const name = trimValue(contact.name || contact.nome || '');
    const phone = trimValue(contact.phone || contact.celular || '');
    return {
      waId,
      name,
      phone,
      isKnownUser: contact.isKnownUser !== false,
    };
  };

  const renderNewConversationList = () => {
    if (
      !elements.newConversationList ||
      !elements.newConversationLoading ||
      !elements.newConversationEmpty
    ) {
      return;
    }

    elements.newConversationList.innerHTML = '';
    elements.newConversationLoading.classList.toggle('hidden', !state.newConversationLoading);
    if (state.newConversationLoading) {
      elements.newConversationEmpty.classList.add('hidden');
      return;
    }

    if (!state.newConversationContacts.length) {
      elements.newConversationEmpty.classList.remove('hidden');
      return;
    }
    elements.newConversationEmpty.classList.add('hidden');

    const fragment = document.createDocumentFragment();
    state.newConversationContacts.forEach((entry) => {
      if (!entry?.waId) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className =
        'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left hover:border-primary/40 hover:bg-primary/5 transition';
      button.dataset.contactWaId = entry.waId;
      button.dataset.contactName = entry.name || '';
      button.dataset.knownUser = entry.isKnownUser ? '1' : '';

      const wrap = document.createElement('div');
      wrap.className = 'flex items-center justify-between gap-3';

      const info = document.createElement('div');
      info.className = 'min-w-0';
      const label = document.createElement('p');
      label.className = 'text-sm font-semibold text-gray-800 truncate';
      label.textContent = entry.name ? formatCustomerName(entry.name) : formatPhone(entry.waId);
      const phone = document.createElement('p');
      phone.className = 'text-xs text-gray-500 truncate';
      phone.textContent = formatPhone(entry.phone || entry.waId);
      info.append(label, phone);

      const badge = document.createElement('span');
      badge.className = 'inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700';
      badge.textContent = 'WhatsApp';

      wrap.append(info, badge);
      button.appendChild(wrap);
      fragment.appendChild(button);
    });

    elements.newConversationList.appendChild(fragment);
  };

  const fetchNewConversationContacts = async (term = '') => {
    if (!API_BASE) return;
    if (!state.selectedCompanyId || !state.selectedNumberId) return;
    state.newConversationLoading = true;
    state.newConversationContacts = [];
    renderNewConversationList();
    try {
      const params = new URLSearchParams();
      if (term) params.set('q', term);
      params.set('limit', '60');
      const resp = await fetch(
        `${API_BASE}/func/clientes/whatsapp?${params.toString()}`,
        { headers: authHeaders(false) }
      );
      const data = await resp.json().catch(() => []);
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao carregar contatos.');
      }
      const list = Array.isArray(data) ? data : [];
      state.newConversationContacts = list
        .map(normalizeNewConversationContact)
        .filter(Boolean);
    } catch (error) {
      console.error('web-whatsapp:new-conversation', error);
      notify(error.message || 'Nao foi possivel carregar os contatos.', 'error');
      state.newConversationContacts = [];
    }
    state.newConversationLoading = false;
    renderNewConversationList();
  };

  const openNewConversationModal = async () => {
    if (!elements.newConversationModal) return;
    if (!state.selectedCompanyId || !state.selectedNumberId) {
      notify('Selecione uma empresa e um numero para iniciar conversa.', 'warning');
      return;
    }
    setModalVisibility(elements.newConversationModal, true);
    if (elements.newConversationSearch) {
      elements.newConversationSearch.value = '';
      elements.newConversationSearch.focus();
    }
    await fetchNewConversationContacts('');
  };

  const closeNewConversationModal = () => {
    setModalVisibility(elements.newConversationModal, false);
    if (elements.newConversationSearch) {
      elements.newConversationSearch.value = '';
    }
    if (newConversationSearchTimer) {
      clearTimeout(newConversationSearchTimer);
      newConversationSearchTimer = null;
    }
    state.newConversationContacts = [];
    state.newConversationLoading = false;
    renderNewConversationList();
  };

  const scheduleNewConversationSearch = () => {
    if (!elements.newConversationSearch) return;
    const term = elements.newConversationSearch.value.trim();
    if (newConversationSearchTimer) {
      clearTimeout(newConversationSearchTimer);
    }
    newConversationSearchTimer = setTimeout(() => {
      void fetchNewConversationContacts(term);
    }, 350);
  };

  const normalizeShareContact = (contact = {}) => {
    const waId = digitsOnly(contact.waId || contact.phone || contact.celular || '');
    if (!waId) return null;
    const name = trimValue(contact.name || contact.nome || '');
    const phone = trimValue(contact.phone || contact.celular || '');
    return {
      waId,
      name,
      phone,
      isKnownUser: contact.isKnownUser !== false,
    };
  };

  const updateShareContactsFooter = () => {
    if (!elements.shareContactsFooter || !elements.shareContactsCount || !elements.shareContactsSend) return;
    const count = state.shareContactsSelected.size;
    elements.shareContactsFooter.classList.toggle('hidden', count === 0);
    elements.shareContactsCount.textContent = `${count} selecionado${count === 1 ? '' : 's'} / 10`;
    elements.shareContactsSend.disabled = state.shareContactsSending;
    elements.shareContactsSend.classList.toggle('opacity-70', state.shareContactsSending);
  };

  const renderShareContactsList = () => {
    if (
      !elements.shareContactsList ||
      !elements.shareContactsLoading ||
      !elements.shareContactsEmpty
    ) {
      return;
    }

    elements.shareContactsList.innerHTML = '';
    elements.shareContactsLoading.classList.toggle('hidden', !state.shareContactsLoading);
    if (state.shareContactsLoading) {
      elements.shareContactsEmpty.classList.add('hidden');
      updateShareContactsFooter();
      return;
    }

    if (!state.shareContacts.length) {
      elements.shareContactsEmpty.classList.remove('hidden');
      updateShareContactsFooter();
      return;
    }
    elements.shareContactsEmpty.classList.add('hidden');

    const fragment = document.createDocumentFragment();
    state.shareContacts.forEach((entry) => {
      if (!entry?.waId) return;
      const selected = state.shareContactsSelected.has(entry.waId);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.shareContactId = entry.waId;
      button.dataset.shareContactName = entry.name || '';
      button.dataset.shareContactPhone = entry.phone || '';
      button.className =
        `w-full flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition ` +
        `${selected ? 'border-primary/40 bg-primary/5' : 'border-gray-200 hover:border-primary/30'}`;

      const avatar = document.createElement('div');
      avatar.className = 'h-9 w-9 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center';
      const avatarIcon = document.createElement('i');
      avatarIcon.className = 'fas fa-user';
      avatar.appendChild(avatarIcon);

      const info = document.createElement('div');
      info.className = 'flex-1 min-w-0';
      const name = document.createElement('p');
      name.className = 'text-sm font-semibold text-gray-800 truncate';
      name.textContent = entry.name || formatPhone(entry.waId);
      const phone = document.createElement('p');
      phone.className = 'text-xs text-gray-500 truncate';
      phone.textContent = formatPhone(entry.phone || entry.waId);
      info.append(name, phone);

      const checkWrap = document.createElement('div');
      checkWrap.className =
        `h-6 w-6 rounded-full border flex items-center justify-center text-xs ` +
        `${selected ? 'bg-primary border-primary text-white' : 'border-gray-300 text-transparent'}`;
      const checkIcon = document.createElement('i');
      checkIcon.className = 'fas fa-check';
      checkWrap.appendChild(checkIcon);

      button.append(avatar, info, checkWrap);
      fragment.appendChild(button);
    });

    elements.shareContactsList.appendChild(fragment);
    updateShareContactsFooter();
  };

  const fetchShareContacts = async (term = '') => {
    if (!API_BASE || !state.selectedCompanyId || !state.selectedNumberId) return;
    state.shareContactsLoading = true;
    state.shareContacts = [];
    renderShareContactsList();
    try {
      const params = new URLSearchParams();
      if (term) params.set('q', term);
      params.set('limit', '60');
      const resp = await fetch(`${API_BASE}/func/clientes/whatsapp?${params.toString()}`, {
        headers: authHeaders(false),
      });
      const data = await resp.json().catch(() => []);
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao carregar contatos.');
      }
      const list = Array.isArray(data) ? data : [];
      state.shareContacts = list.map(normalizeShareContact).filter(Boolean);
    } catch (error) {
      console.error('web-whatsapp:share-contacts', error);
      notify(error.message || 'Nao foi possivel carregar os contatos.', 'error');
      state.shareContacts = [];
    }
    state.shareContactsLoading = false;
    renderShareContactsList();
  };

  const openShareContactsModal = async () => {
    if (!elements.shareContactsModal) return;
    if (!state.selectedCompanyId || !state.selectedNumberId || !state.selectedContactId) {
      notify('Selecione uma conversa antes de compartilhar contatos.', 'warning');
      return;
    }
    setModalVisibility(elements.shareContactsModal, true);
    if (elements.shareContactsSearch) {
      elements.shareContactsSearch.value = '';
      elements.shareContactsSearch.focus();
    }
    state.shareContactsSelected.clear();
    updateShareContactsFooter();
    await fetchShareContacts('');
  };

  const closeShareContactsModal = () => {
    setModalVisibility(elements.shareContactsModal, false);
    if (elements.shareContactsSearch) {
      elements.shareContactsSearch.value = '';
    }
    if (shareContactsSearchTimer) {
      clearTimeout(shareContactsSearchTimer);
      shareContactsSearchTimer = null;
    }
    state.shareContacts = [];
    state.shareContactsLoading = false;
    state.shareContactsSelected.clear();
    state.shareContactsSending = false;
    renderShareContactsList();
  };

  const scheduleShareContactsSearch = () => {
    if (!elements.shareContactsSearch) return;
    const term = elements.shareContactsSearch.value.trim();
    if (shareContactsSearchTimer) {
      clearTimeout(shareContactsSearchTimer);
    }
    shareContactsSearchTimer = setTimeout(() => {
      void fetchShareContacts(term);
    }, 350);
  };

  const toggleShareContactSelection = (waId, name, phone) => {
    if (!waId) return;
    if (state.shareContactsSelected.has(waId)) {
      state.shareContactsSelected.delete(waId);
      renderShareContactsList();
      return;
    }
    if (state.shareContactsSelected.size >= 10) {
      notify('Voce pode selecionar ate 10 contatos.', 'warning');
      return;
    }
    state.shareContactsSelected.set(waId, { waId, name, phone });
    renderShareContactsList();
  };

  const buildLocalShareContactsPayload = (contacts = []) => {
    return contacts.map((entry) => {
      const waId = digitsOnly(entry?.waId || entry?.phone || '');
      const formattedName = trimValue(entry?.name) || formatPhone(waId) || 'Contato';
      return {
        name: { formatted_name: formattedName },
        phones: [
          {
            phone: waId ? `+${waId}` : '',
            wa_id: waId || '',
            type: 'CELL',
          },
        ],
      };
    });
  };

  const renderPetsModal = (pets = []) => {
    if (!elements.petsModalList || !elements.petsModalEmpty || !elements.petsModalLoading) return;
    elements.petsModalList.innerHTML = '';
    elements.petsModalLoading.classList.add('hidden');
    if (!Array.isArray(pets) || pets.length === 0) {
      elements.petsModalEmpty.classList.remove('hidden');
      return;
    }
    elements.petsModalEmpty.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    pets.forEach((pet) => {
      const card = document.createElement('div');
      card.className = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm';
      const name = pet?.nome || 'Sem nome';
      const code = pet?.codigo || pet?.codigoPet || '';
      const status = pet?.obito ? 'Obito' : '';
      const header = document.createElement('div');
      header.className = 'flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-800';
      const title = document.createElement('span');
      title.textContent = name;
      header.appendChild(title);
      if (code) {
        const badge = document.createElement('span');
        badge.className = 'inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700';
        badge.textContent = `Codigo ${code}`;
        header.appendChild(badge);
      }
      if (status) {
        const badge = document.createElement('span');
        badge.className = 'inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700';
        badge.textContent = status;
        header.appendChild(badge);
      }
      const details = document.createElement('div');
      details.className = 'mt-2 space-y-1 text-xs text-gray-600';
      const info = [
        pet?.tipo ? `Tipo: ${pet.tipo}` : '',
        pet?.raca ? `Raca: ${pet.raca}` : '',
        pet?.porte ? `Porte: ${pet.porte}` : '',
        pet?.sexo ? `Sexo: ${pet.sexo}` : '',
      ].filter(Boolean);
      info.forEach((line) => {
        const item = document.createElement('div');
        item.textContent = line;
        details.appendChild(item);
      });
      card.append(header, details);
      fragment.appendChild(card);
    });
    elements.petsModalList.appendChild(fragment);
  };

  const renderAddressModal = (addresses = []) => {
    if (!elements.addressModalList || !elements.addressModalEmpty || !elements.addressModalLoading) return;
    elements.addressModalList.innerHTML = '';
    elements.addressModalLoading.classList.add('hidden');
    if (!Array.isArray(addresses) || addresses.length === 0) {
      elements.addressModalEmpty.classList.remove('hidden');
      return;
    }
    elements.addressModalEmpty.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    addresses.forEach((address) => {
      const card = document.createElement('div');
      card.className = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm';
      const header = document.createElement('div');
      header.className = 'flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-800';
      const title = document.createElement('span');
      title.textContent = address?.apelido || 'Endereco';
      header.appendChild(title);
      if (address?.isDefault) {
        const badge = document.createElement('span');
        badge.className = 'inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700';
        badge.textContent = 'Principal';
        header.appendChild(badge);
      }
      const line1 = [address?.logradouro, address?.numero].filter(Boolean).join(', ');
      const line2 = [address?.bairro, address?.cidade].filter(Boolean).join(' - ');
      const line3 = [address?.uf, address?.cep].filter(Boolean).join(' ');
      const details = [line1, address?.complemento, line2, line3].filter(Boolean);
      const body = document.createElement('div');
      body.className = 'mt-2 space-y-1 text-xs text-gray-600';
      details.forEach((line) => {
        const item = document.createElement('div');
        item.textContent = line;
        body.appendChild(item);
      });
      card.append(header, body);
      fragment.appendChild(card);
    });
    elements.addressModalList.appendChild(fragment);
  };

  const resolveSelectedCustomer = async () => {
    const contactId = state.selectedContactId;
    if (!contactId) {
      notify('Selecione uma conversa.', 'warning');
      return null;
    }
    try {
      const customer = await resolveCustomerByPhone(contactId);
      if (!customer) {
        notify('Cliente nao encontrado para este contato.', 'warning');
        return null;
      }
      return customer;
    } catch (error) {
      notify(error.message || 'Nao foi possivel localizar o cliente.', 'error');
      return null;
    }
  };

  const openCustomerCadastro = async () => {
    const customer = await resolveSelectedCustomer();
    if (!customer) return;
    const url = new URL('../funcionarios/clientes.html', window.location.href);
    url.searchParams.set('clienteId', customer.id);
    if (state.selectedCompanyId) {
      url.searchParams.set('storeId', state.selectedCompanyId);
    }
    window.open(url.toString(), '_blank', 'noopener');
  };

  const openPdvWithCustomer = async () => {
    const customer = await resolveSelectedCustomer();
    if (!customer) return;
    const url = new URL('admin-pdv.html', window.location.href);
    url.searchParams.set('clienteId', customer.id);
    if (state.selectedCompanyId) {
      url.searchParams.set('storeId', state.selectedCompanyId);
    }
    window.open(url.toString(), '_blank', 'noopener');
  };

  const openPetsModal = async () => {
    const customer = await resolveSelectedCustomer();
    if (!customer) return;
    if (elements.petsModalTitle) {
      elements.petsModalTitle.textContent = customer.name ? `Pets de ${customer.name}` : 'Pets do cliente';
    }
    setModalVisibility(elements.petsModal, true);
    if (elements.petsModalLoading) elements.petsModalLoading.classList.remove('hidden');
    if (elements.petsModalEmpty) elements.petsModalEmpty.classList.add('hidden');
    if (elements.petsModalList) elements.petsModalList.innerHTML = '';

    if (state.customerPetsCache.has(customer.id)) {
      renderPetsModal(state.customerPetsCache.get(customer.id));
      return;
    }
    try {
      const resp = await fetch(`${API_BASE}/func/clientes/${customer.id}/pets?includeDeceased=1`, {
        headers: authHeaders(false),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.message || 'Nao foi possivel carregar os pets.');
      }
      const list = await resp.json().catch(() => []);
      const pets = Array.isArray(list) ? list : [];
      state.customerPetsCache.set(customer.id, pets);
      renderPetsModal(pets);
    } catch (error) {
      renderPetsModal([]);
      notify(error.message || 'Nao foi possivel carregar os pets.', 'error');
    }
  };

  const openAddressModal = async () => {
    const customer = await resolveSelectedCustomer();
    if (!customer) return;
    if (elements.addressModalTitle) {
      elements.addressModalTitle.textContent = customer.name ? `Enderecos de ${customer.name}` : 'Enderecos do cliente';
    }
    setModalVisibility(elements.addressModal, true);
    if (elements.addressModalLoading) elements.addressModalLoading.classList.remove('hidden');
    if (elements.addressModalEmpty) elements.addressModalEmpty.classList.add('hidden');
    if (elements.addressModalList) elements.addressModalList.innerHTML = '';

    if (state.customerAddressCache.has(customer.id)) {
      renderAddressModal(state.customerAddressCache.get(customer.id));
      return;
    }
    try {
      const resp = await fetch(`${API_BASE}/func/clientes/${customer.id}/enderecos`, {
        headers: authHeaders(false),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.message || 'Nao foi possivel carregar os enderecos.');
      }
      const list = await resp.json().catch(() => []);
      const addresses = Array.isArray(list) ? list : [];
      state.customerAddressCache.set(customer.id, addresses);
      renderAddressModal(addresses);
    } catch (error) {
      renderAddressModal([]);
      notify(error.message || 'Nao foi possivel carregar os enderecos.', 'error');
    }
  };

  const handleChatMenuAction = (action) => {
    if (!action) return;
    if (action === 'profile') {
      void openCustomerCadastro();
      return;
    }
    if (action === 'pets') {
      void openPetsModal();
      return;
    }
    if (action === 'addresses') {
      void openAddressModal();
      return;
    }
    if (action === 'sell') {
      void openPdvWithCustomer();
    }
  };

  const buildChatMenuPopover = () => {
    const popover = document.createElement('div');
    popover.id = 'web-whatsapp-chat-menu-popover';
    popover.className =
      'fixed z-50 w-48 rounded-2xl border border-gray-200 bg-white text-gray-700 shadow-xl';
    popover.setAttribute('role', 'menu');
    popover.setAttribute('aria-label', 'Acoes da conversa');

    const list = document.createElement('div');
    list.className = 'flex flex-col gap-1 p-2';

    const options = [
      { key: 'profile', label: 'Ver Cadastro', icon: 'fas fa-id-card' },
      { key: 'pets', label: 'Pets', icon: 'fas fa-paw' },
      { key: 'addresses', label: 'Endereços', icon: 'fas fa-map-location-dot' },
      { key: 'sell', label: 'Vender', icon: 'fas fa-bag-shopping' },
    ];

    options.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.chatMenuOption = item.key;
      button.className =
        'flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-primary/10 hover:text-primary transition';
      const icon = document.createElement('i');
      icon.className = item.icon;
      const label = document.createElement('span');
      label.textContent = item.label;
      button.append(icon, label);
      list.appendChild(button);
    });

    popover.appendChild(list);
    return popover;
  };

  const positionChatMenuPopover = () => {
    if (!state.chatMenuPopover || !elements.chatMenuButton) return;
    const popover = state.chatMenuPopover;
    popover.style.visibility = 'hidden';
    popover.style.left = '0px';
    popover.style.top = '0px';
    const anchorRect = elements.chatMenuButton.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const spacing = 10;
    let top = anchorRect.bottom + spacing;
    if (top + popRect.height > window.innerHeight - spacing) {
      top = anchorRect.top - popRect.height - spacing;
    }
    let left = anchorRect.right - popRect.width;
    if (left < spacing) left = spacing;
    if (left + popRect.width > window.innerWidth - spacing) {
      left = window.innerWidth - popRect.width - spacing;
    }
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.style.visibility = 'visible';
  };

  const openChatMenuPopover = () => {
    if (!elements.chatMenuButton || state.chatMenuPopover) return;
    if (!state.selectedContactId) return;
    closeEmojiPopover();
    closeAttachPopover();
    const popover = buildChatMenuPopover();
    state.chatMenuPopover = popover;
    document.body.appendChild(popover);
    positionChatMenuPopover();

    const handleOutsideClick = (event) => {
      if (popover.contains(event.target) || elements.chatMenuButton.contains(event.target)) return;
      closeChatMenuPopover();
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeChatMenuPopover();
    };
    const handleResize = () => closeChatMenuPopover();
    const handleScroll = (event) => {
      if (event?.target && popover.contains(event.target)) return;
      closeChatMenuPopover();
    };

    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    state.chatMenuCleanup = () => {
      document.removeEventListener('click', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };

    popover.addEventListener('click', (event) => {
      const option = event.target.closest('button[data-chat-menu-option]');
      if (!option) return;
      const action = option.dataset.chatMenuOption || '';
      closeChatMenuPopover();
      handleChatMenuAction(action);
    });
  };

  const toggleChatMenuPopover = () => {
    if (state.chatMenuPopover) {
      closeChatMenuPopover();
    } else {
      openChatMenuPopover();
    }
  };

  const scrollToEmojiCategory = (category) => {
    if (!state.emojiPopoverData) return;
    const { sections, listWrap } = state.emojiPopoverData;
    const target = sections.get(category)?.section;
    if (!target || !listWrap) return;
    listWrap.scrollTo({
      top: target.offsetTop,
      behavior: 'smooth',
    });
    setEmojiActiveCategory(category);
  };

  const updateActiveEmojiCategoryFromScroll = () => {
    if (!state.emojiPopoverData) return;
    if (state.emojiPanelMode !== 'emoji') return;
    if (state.emojiSearch.trim()) return;
    const { sections, listWrap } = state.emojiPopoverData;
    if (!listWrap) return;
    const scrollTop = listWrap.scrollTop + 16;
    let active = 'recent';
    EMOJI_CATEGORIES.forEach((category) => {
      const section = sections.get(category.key)?.section;
      if (!section || section.classList.contains('hidden')) return;
      if (section.offsetTop <= scrollTop) {
        active = category.key;
      }
    });
    setEmojiActiveCategory(active);
  };

  const openEmojiPopover = () => {
    if (!elements.emojiButton || state.emojiPopover) return;
    closeChatMenuPopover();
    const { popover, ...rest } = buildEmojiPopover();
    state.emojiPopover = popover;
    state.emojiPopoverData = rest;
    state.emojiSearch = '';
    state.emojiPanelMode = 'emoji';
    document.body.appendChild(popover);
    renderEmojiPopover();
    positionEmojiPopover();

    const handleOutsideClick = (event) => {
      if (popover.contains(event.target) || elements.emojiButton.contains(event.target)) return;
      closeEmojiPopover();
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeEmojiPopover();
    };
    const handleResize = () => closeEmojiPopover();
    const handleScroll = (event) => {
      if (event?.target && popover.contains(event.target)) return;
      closeEmojiPopover();
    };
    const handleListScroll = () => {
      updateActiveEmojiCategoryFromScroll();
    };

    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    state.emojiPopoverData?.listWrap?.addEventListener('scroll', handleListScroll);
    state.emojiCleanup = () => {
      document.removeEventListener('click', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
      state.emojiPopoverData?.listWrap?.removeEventListener('scroll', handleListScroll);
    };

    popover.addEventListener('click', (event) => {
      const emojiButton = event.target.closest('button[data-emoji]');
      if (emojiButton) {
        const emoji = emojiButton.dataset.emoji;
        if (emoji) {
          insertEmoji(emoji);
          addEmojiRecent(emoji);
          renderEmojiPopover();
        }
        return;
      }
      const tab = event.target.closest('button[data-emoji-category]');
      if (tab) {
        if (state.emojiPanelMode !== 'emoji') {
          setEmojiPanelMode('emoji');
        }
        const category = tab.dataset.emojiCategory || 'recent';
        if (state.emojiSearch.trim()) {
          state.emojiSearch = '';
          if (state.emojiPopoverData?.searchInput) {
            state.emojiPopoverData.searchInput.value = '';
          }
          renderEmojiPopover();
        }
        scrollToEmojiCategory(category);
        return;
      }
      const panel = event.target.closest('button[data-emoji-panel]');
      if (panel) {
        const mode = panel.dataset.emojiPanel || 'emoji';
        setEmojiPanelMode(mode);
        renderEmojiPopover();
      }
    });

    if (state.emojiPopoverData?.searchInput) {
      state.emojiPopoverData.searchInput.addEventListener('input', (event) => {
        state.emojiSearch = event.target.value || '';
        renderEmojiPopover();
        updateActiveEmojiCategoryFromScroll();
      });
    }

    updateActiveEmojiCategoryFromScroll();
  };

  const toggleEmojiPopover = () => {
    if (state.emojiPopover) {
      closeEmojiPopover();
    } else {
      openEmojiPopover();
    }
  };

  const insertEmoji = (emoji) => {
    if (!elements.input) return;
    const input = elements.input;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = `${input.value.slice(0, start)}${emoji}${input.value.slice(end)}`;
    const cursor = start + emoji.length;
    input.setSelectionRange(cursor, cursor);
    input.focus();
    setSendState();
  };

  const updateRecordingControls = () => {
    const showRecording = state.recording || state.recordingPaused || state.recordingReady;
    if (elements.recordingBar) {
      elements.recordingBar.classList.toggle('hidden', !showRecording);
    }
    if (showRecording) {
      ensureWaveBars();
    } else {
      stopWaveAnimation();
    }
    if (elements.inputWrap) {
      elements.inputWrap.classList.toggle('hidden', showRecording);
    }
    if (elements.attachButton) {
      elements.attachButton.classList.toggle('hidden', showRecording);
    }
    if (elements.emojiButton) {
      elements.emojiButton.classList.toggle('hidden', showRecording);
    }
    if (showRecording) {
      closeEmojiPopover();
      closeAttachPopover();
      closeChatMenuPopover();
    }

    if (elements.recordingToggle) {
      const canToggle = state.recording || state.recordingPaused;
      const icon = elements.recordingToggle.querySelector('i');
      elements.recordingToggle.disabled = !canToggle;
      elements.recordingToggle.classList.toggle('opacity-60', !canToggle);
      if (icon) {
        icon.classList.toggle('fa-pause', !state.recordingPaused);
        icon.classList.toggle('fa-microphone', state.recordingPaused);
        icon.classList.remove('fa-play');
      }
      elements.recordingToggle.setAttribute('aria-label', state.recordingPaused ? 'Retomar gravacao' : 'Pausar gravacao');
    }

    if (elements.recordingDot) {
      elements.recordingDot.classList.toggle('opacity-60', state.recordingPaused);
      elements.recordingDot.classList.toggle('opacity-100', !state.recordingPaused);
    }

    if (elements.recordingPlay) {
      const canPlay = (state.recordingReady || state.recordingPaused) && state.recordingAudio;
      const icon = elements.recordingPlay.querySelector('i');
      elements.recordingPlay.disabled = !canPlay;
      elements.recordingPlay.classList.toggle('opacity-60', !canPlay);
      if (icon) {
        const playing = isRecordingPlaybackActive();
        icon.classList.toggle('fa-play', !playing);
        icon.classList.toggle('fa-pause', playing);
      }
    }
  };

  const setChatChromeVisible = (visible) => {
    const isVisible = Boolean(visible);
    if (elements.chatHeader) {
      elements.chatHeader.classList.toggle('hidden', !isVisible);
    }
    if (elements.chatFooter) {
      elements.chatFooter.classList.toggle('hidden', !isVisible);
    }
    if (!isVisible) {
      closeChatMenuPopover();
      closeCustomerModals();
    }
  };

  const setBusinessProfileVisible = (visible) => {
    if (!elements.businessProfilePanel) return;
    elements.businessProfilePanel.classList.toggle('translate-x-full', !visible);
    elements.businessProfilePanel.classList.toggle('translate-x-0', visible);
  };

  const closeBusinessProfilePanel = () => {
    setBusinessProfileVisible(false);
    setBusinessProfileEditing(false);
  };

  const openBusinessProfilePanel = async () => {
    if (!elements.businessProfilePanel) return;
    if (!state.selectedCompanyId || !state.selectedNumberId) {
      notify('Selecione uma empresa e um numero conectado.', 'warning');
      return;
    }
    closeProfilePanel();
    setBusinessProfileVisible(true);
    await loadBusinessProfile();
  };

  const toggleBusinessProfilePanel = () => {
    if (!elements.businessProfilePanel) return;
    const isOpen = elements.businessProfilePanel.classList.contains('translate-x-0');
    if (isOpen) {
      closeBusinessProfilePanel();
      return;
    }
    void openBusinessProfilePanel();
  };

  const updateBusinessProfileHeader = (meta = {}) => {
    const label = trimValue(meta.numberLabel || '') || trimValue(state.selectedNumber?.displayName || '') || 'Perfil empresarial';
    const phone = trimValue(meta.phoneNumber || '') || trimValue(state.selectedNumber?.phoneNumber || '') || trimValue(state.selectedNumberId || '');
    if (elements.businessProfileName) {
      elements.businessProfileName.textContent = label || 'Perfil empresarial';
    }
    if (elements.businessProfileNumber) {
      elements.businessProfileNumber.textContent = phone ? formatPhone(phone) : '--';
    }
  };

  const setBusinessProfileEditing = (editing) => {
    state.businessProfileEditing = Boolean(editing);
    const fields = [
      elements.businessProfileAbout,
      elements.businessProfileAddress,
      elements.businessProfileDescription,
      elements.businessProfileEmail,
      elements.businessProfileWebsites,
      elements.businessProfileVertical,
    ];
    fields.forEach((field) => {
      if (field) field.disabled = !state.businessProfileEditing;
    });

    if (elements.businessProfileActions) {
      elements.businessProfileActions.classList.toggle('hidden', !state.businessProfileEditing);
    }
    if (elements.businessProfileEdit) {
      elements.businessProfileEdit.classList.toggle('hidden', state.businessProfileEditing);
    }
  };

  const setBusinessProfileForm = (profile = {}) => {
    if (elements.businessProfileAbout) elements.businessProfileAbout.value = profile.about || '';
    if (elements.businessProfileAddress) elements.businessProfileAddress.value = profile.address || '';
    if (elements.businessProfileDescription) elements.businessProfileDescription.value = profile.description || '';
    if (elements.businessProfileEmail) elements.businessProfileEmail.value = profile.email || '';
    if (elements.businessProfileWebsites) {
      const websites = Array.isArray(profile.websites) ? profile.websites : [];
      elements.businessProfileWebsites.value = websites.join('\n');
    }
    if (elements.businessProfileVertical) elements.businessProfileVertical.value = profile.vertical || '';
    if (elements.businessProfileAvatar) {
      elements.businessProfileAvatar.src = profile.profile_picture_url || '/public/image/placeholder.svg';
    }
  };

  const normalizeWebsitesInput = (value) => {
    if (!value) return [];
    const text = String(value || '').trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => trimValue(entry)).filter(Boolean);
      }
    } catch (_) {
      // ignore
    }
    return text
      .split(/[\n,]+/)
      .map((entry) => trimValue(entry))
      .filter(Boolean);
  };

  const buildBusinessProfilePayload = () => ({
    about: trimValue(elements.businessProfileAbout?.value),
    address: trimValue(elements.businessProfileAddress?.value),
    description: trimValue(elements.businessProfileDescription?.value),
    email: trimValue(elements.businessProfileEmail?.value),
    websites: normalizeWebsitesInput(elements.businessProfileWebsites?.value),
    vertical: trimValue(elements.businessProfileVertical?.value),
  });

  const loadBusinessProfile = async () => {
    if (!API_BASE || !state.selectedCompanyId || !state.selectedNumberId) return;
    state.businessProfileLoading = true;
    setBusinessProfileEditing(false);
    updateBusinessProfileHeader();

    try {
      const url = new URL(`${API_BASE}/integrations/whatsapp/${state.selectedCompanyId}/business-profile`);
      url.searchParams.set('phoneNumberId', state.selectedNumberId);
      const resp = await fetch(url.toString(), { headers: authHeaders(false) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao carregar perfil empresarial.');
      }
      const profile = data?.profile || {};
      state.businessProfile = profile;
      updateBusinessProfileHeader(data || {});
      setBusinessProfileForm(profile);
    } catch (error) {
      console.error('web-whatsapp:business-profile', error);
      notify('Nao foi possivel carregar o perfil empresarial.', 'error');
      state.businessProfile = null;
      setBusinessProfileForm({});
    }

    state.businessProfileLoading = false;
  };

  const saveBusinessProfile = async () => {
    if (!API_BASE || !state.selectedCompanyId || !state.selectedNumberId) return;
    const payload = buildBusinessProfilePayload();

    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${state.selectedCompanyId}/business-profile`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          phoneNumberId: state.selectedNumberId,
          ...payload,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao atualizar perfil empresarial.');
      }
      notify('Perfil atualizado com sucesso.', 'success');
      await loadBusinessProfile();
      setBusinessProfileEditing(false);
    } catch (error) {
      console.error('web-whatsapp:business-profile-save', error);
      notify(error.message || 'Nao foi possivel atualizar o perfil.', 'error');
    }
  };

  const uploadBusinessProfilePicture = async (file) => {
    if (!file) return false;
    if (!API_BASE || !state.selectedCompanyId || !state.selectedNumberId) {
      notify('Selecione uma empresa e um numero conectado.', 'warning');
      return;
    }
    if (!file.type || !file.type.startsWith('image/')) {
      notify('Selecione uma imagem valida.', 'warning');
      return;
    }
    if (file.size > BUSINESS_PROFILE_IMAGE_MAX_BYTES) {
      notify('A imagem deve ter no maximo 5MB.', 'warning');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('phoneNumberId', state.selectedNumberId);

    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${state.selectedCompanyId}/business-profile/picture`, {
        method: 'POST',
        headers: authHeaders(false),
        body: formData,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao enviar imagem.');
      }
      notify('Imagem atualizada com sucesso.', 'success');
      await loadBusinessProfile();
    } catch (error) {
      console.error('web-whatsapp:business-profile-picture', error);
      notify(error.message || 'Nao foi possivel atualizar a imagem.', 'error');
    }
  };

  const populateCompanySelect = () => {
    if (!elements.companySelect) return;
    elements.companySelect.innerHTML = '';

    if (!state.companies.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Nenhuma empresa encontrada';
      elements.companySelect.appendChild(option);
      elements.companySelect.disabled = true;
      return;
    }

    state.companies.forEach((company) => {
      const option = document.createElement('option');
      option.value = company.id;
      option.textContent = company.name;
      elements.companySelect.appendChild(option);
    });

    elements.companySelect.disabled = false;
  };

  const updateSelectedNumber = () => {
    const numbers = state.numbersByCompany[state.selectedCompanyId] || [];
    state.selectedNumber = numbers.find((entry) => entry.phoneNumberId === state.selectedNumberId) || null;
    setConnectionBadge(state.selectedNumber?.status || 'Pendente');
    updateBusinessProfileHeader();
  };

  const populateNumberSelect = () => {
    if (!elements.numberSelect) return;
    elements.numberSelect.innerHTML = '';

    if (!state.selectedCompanyId) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Selecione uma empresa';
      elements.numberSelect.appendChild(option);
      elements.numberSelect.disabled = true;
      return;
    }

    const numbers = state.numbersByCompany[state.selectedCompanyId] || [];
    const connected = numbers.filter((number) => number.status === 'Conectado');

    if (!connected.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Nenhum numero conectado';
      elements.numberSelect.appendChild(option);
      elements.numberSelect.disabled = true;
      state.selectedNumberId = '';
      updateSelectedNumber();
      return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecione um numero';
    elements.numberSelect.appendChild(placeholder);

    connected.forEach((number) => {
      const option = document.createElement('option');
      option.value = number.phoneNumberId;
      option.dataset.numberId = number.id || '';
      const label = number.displayName || 'Numero';
      const phone = number.phoneNumber || number.phoneNumberId || '--';
      option.textContent = `${label} (${phone})`;
      elements.numberSelect.appendChild(option);
    });

    elements.numberSelect.disabled = false;
    const fallback = connected[0]?.phoneNumberId || '';
    const currentValue = state.selectedNumberId && connected.some((n) => n.phoneNumberId === state.selectedNumberId)
      ? state.selectedNumberId
      : fallback;
    elements.numberSelect.value = currentValue;
    state.selectedNumberId = currentValue;
    updateSelectedNumber();
  };

  const loadNumbersForCompany = async (companyId) => {
    if (!API_BASE || !companyId) {
      populateNumberSelect();
      return;
    }

    if (elements.numberSelect) {
      elements.numberSelect.innerHTML = '<option value="">Carregando...</option>';
      elements.numberSelect.disabled = true;
    }

    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${companyId}`, {
        headers: authHeaders(false),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao carregar numeros.');
      }

      const numbers = Array.isArray(data?.phoneNumbers) ? data.phoneNumbers : [];
      state.numbersByCompany[companyId] = numbers.map(normalizeNumber);
    } catch (error) {
      console.error('web-whatsapp:numbers', error);
      state.numbersByCompany[companyId] = [];
      notify('Nao foi possivel carregar os numeros do WhatsApp.', 'error');
    }

    populateNumberSelect();
    await ensureSocket();
    syncSocketRoom();
  };

  const loadCompanies = async () => {
    if (!elements.companySelect || !API_BASE) return;

    elements.companySelect.innerHTML = '<option value="">Carregando...</option>';
    elements.companySelect.disabled = true;

    try {
      const resp = await fetch(`${API_BASE}/stores/allowed`, { headers: authHeaders(false) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao carregar empresas.');
      }

      const stores = Array.isArray(data?.stores) ? data.stores : [];
      state.companies = stores.map((store) => ({
        id: store._id,
        name: store.nome || store.razaoSocial || 'Empresa sem nome',
      }));

      state.selectedCompanyId = state.companies[0]?.id || '';
      populateCompanySelect();
      if (elements.companySelect && state.selectedCompanyId) {
        elements.companySelect.value = state.selectedCompanyId;
      }
      await loadNumbersForCompany(state.selectedCompanyId);
    } catch (error) {
      console.error('web-whatsapp:companies', error);
      elements.companySelect.innerHTML = '<option value="">Erro ao carregar empresas</option>';
      elements.companySelect.disabled = true;
      notify('Nao foi possivel carregar as empresas.', 'error');
    }
  };

  const renderConversations = () => {
    if (!elements.conversations) return;
    elements.conversations.innerHTML = '';

    if (state.loadingContacts) {
      const loading = document.createElement('div');
      loading.className = 'rounded-lg border border-dashed border-gray-200 bg-white p-3 text-xs text-gray-500';
      loading.textContent = 'Carregando conversas...';
      elements.conversations.appendChild(loading);
      elements.conversationsEmpty?.classList.add('hidden');
      return;
    }

    const term = state.searchTerm.trim().toLowerCase();
    const filtered = term
      ? state.contacts.filter((contact) => {
          const name = (contact.name || '').toLowerCase();
          const phone = contact.waId || '';
          return name.includes(term) || phone.includes(digitsOnly(term)) || phone.includes(term);
        })
      : state.contacts;

    if (!filtered.length) {
      elements.conversationsEmpty?.classList.remove('hidden');
      return;
    }

    elements.conversationsEmpty?.classList.add('hidden');
    filtered.forEach((contact) => {
      const button = document.createElement('button');
      const isActive = contact.waId === state.selectedContactId;
      button.type = 'button';
      button.dataset.waId = contact.waId;
      button.className = isActive
        ? 'w-full rounded-lg bg-white border border-gray-200 p-3 text-left shadow-sm hover:border-primary/40 transition'
        : 'w-full rounded-lg border border-transparent p-3 text-left hover:bg-white hover:border-gray-200 transition';

      const wrapper = document.createElement('div');
      wrapper.className = 'flex items-center gap-3';

      const avatar = document.createElement('img');
      avatar.src = '/public/image/placeholder.svg';
      avatar.alt = 'Cliente';
      avatar.className = 'h-10 w-10 rounded-full object-cover bg-gray-100';

      const info = document.createElement('div');
      info.className = 'flex-1 min-w-0';

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between gap-2';

      const nameWrap = document.createElement('div');
      nameWrap.className = 'flex items-center gap-2 min-w-0';
      const name = document.createElement('p');
      name.className = 'text-sm font-semibold text-gray-800 truncate';
      name.textContent = getContactLabel(contact);
      nameWrap.appendChild(name);
      if (contact.isKnownUser) {
        const dot = document.createElement('span');
        dot.className = 'h-2 w-2 rounded-full bg-blue-500';
        dot.title = 'Cadastro encontrado';
        dot.setAttribute('aria-label', 'Cadastro encontrado');
        nameWrap.appendChild(dot);
      }

      const meta = document.createElement('div');
      meta.className = 'flex items-center gap-2 text-[11px] text-gray-500';

      const time = document.createElement('span');
      time.className = 'text-[11px] text-gray-500';
      time.textContent = formatListTime(contact.lastMessageAt);
      meta.appendChild(time);

      const unreadCount = normalizeUnreadCount(contact.unreadCount);
      if (unreadCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'inline-flex items-center justify-center rounded-full bg-emerald-500 text-white text-[11px] font-semibold px-2';
        badge.textContent = String(unreadCount);
        meta.appendChild(badge);
      }

      const preview = document.createElement('div');
      preview.className = 'flex items-center gap-1 text-xs text-gray-500 min-w-0';
      if (contact.lastDirection === 'outgoing') {
        const tickInfo = buildStatusTick(contact.lastStatus || 'Enviado');
        if (tickInfo) {
          const tick = document.createElement('i');
          tick.className = `fas ${tickInfo.icon} ${tickInfo.color} text-[10px]`;
          preview.appendChild(tick);
        }
      }
      const previewText = document.createElement('span');
      previewText.className = 'truncate';
      previewText.textContent = contact.lastMessage || 'Sem mensagens';
      preview.appendChild(previewText);

      header.appendChild(nameWrap);
      header.appendChild(meta);
      info.appendChild(header);
      info.appendChild(preview);
      wrapper.appendChild(avatar);
      wrapper.appendChild(info);
      button.appendChild(wrapper);
      elements.conversations.appendChild(button);
    });
  };

  const renderChatTags = (contact) => {
    if (!elements.chatTags) return;
    elements.chatTags.innerHTML = '';
    if (!contact?.isKnownUser) return;
    [
      { label: 'Pets', key: 'pets' },
      { label: 'Endereços', key: 'addresses' },
    ].forEach((item) => {
      const tag = document.createElement('button');
      tag.type = 'button';
      tag.dataset.chatTag = item.key;
      tag.className =
        'inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/20 transition';
      tag.textContent = item.label;
      elements.chatTags.appendChild(tag);
    });
  };

  const updateChatHeader = () => {
    if (!elements.chatName || !elements.chatStatus) return;
    const contact = state.contacts.find((entry) => entry.waId === state.selectedContactId) || null;
    if (!contact) {
      elements.chatName.textContent = 'Selecione uma conversa';
      elements.chatStatus.textContent = 'Aguardando selecao';
      renderChatTags(null);
      renderProfilePanel();
      closeProfilePanel();
      setChatChromeVisible(false);
      return;
    }
    setChatChromeVisible(true);
    elements.chatName.textContent = getContactLabel(contact);
    renderChatTags(contact);
    elements.chatStatus.textContent = contact.lastMessageAt
      ? `Ultima mensagem ${formatListTime(contact.lastMessageAt)}`
      : 'Sem mensagens';
    renderProfilePanel();
  };

  const renderProfilePanel = () => {
    if (!elements.profilePanel) return;
    const contact = state.contacts.find((entry) => entry.waId === state.selectedContactId) || null;
    if (!contact) {
      if (elements.profileName) elements.profileName.textContent = '--';
      if (elements.profilePhone) elements.profilePhone.textContent = '--';
      if (elements.profileLastMessage) elements.profileLastMessage.textContent = '--';
      if (elements.profileLastActivity) elements.profileLastActivity.textContent = '--';
      if (elements.profileBlockLabel) elements.profileBlockLabel.textContent = 'Bloquear (Contato)';
      return;
    }

    if (elements.profileName) elements.profileName.textContent = getContactLabel(contact);
    if (elements.profilePhone) elements.profilePhone.textContent = contact.waId ? formatPhone(contact.waId) : '--';
    if (elements.profileBlockLabel) elements.profileBlockLabel.textContent = `Bloquear (${getContactLabel(contact)})`;
    if (elements.profileLastMessage) {
      elements.profileLastMessage.textContent = contact.lastMessage || 'Sem mensagens';
    }
    if (elements.profileLastActivity) {
      elements.profileLastActivity.textContent = contact.lastMessageAt
        ? formatListTime(contact.lastMessageAt)
        : 'Sem atividade';
    }
  };

  const openProfilePanel = () => {
    if (!elements.profilePanel || !state.selectedContactId) return;
    closeBusinessProfilePanel();
    renderProfilePanel();
    elements.profilePanel.classList.remove('translate-x-full');
    elements.profilePanel.classList.add('translate-x-0');
  };

  const closeProfilePanel = () => {
    if (!elements.profilePanel) return;
    elements.profilePanel.classList.add('translate-x-full');
    elements.profilePanel.classList.remove('translate-x-0');
  };

  const toggleProfilePanel = () => {
    if (!elements.profilePanel) return;
    const isOpen = elements.profilePanel.classList.contains('translate-x-0');
    if (isOpen) {
      closeProfilePanel();
      return;
    }
    openProfilePanel();
  };

  const formatContactName = (contact) => {
    if (!contact || typeof contact !== 'object') return '';
    const name = contact.name || {};
    const formatted = trimValue(name.formatted_name || name.formattedName);
    if (formatted) return formatted;
    const parts = [
      trimValue(name.prefix),
      trimValue(name.first_name || name.firstName),
      trimValue(name.middle_name || name.middleName),
      trimValue(name.last_name || name.lastName),
      trimValue(name.suffix),
    ].filter(Boolean);
    return parts.join(' ');
  };

  const resolveContactWaId = (contact) => {
    if (!contact || typeof contact !== 'object') return '';
    const phones = Array.isArray(contact.phones) ? contact.phones : [];
    const preferred = phones.find((phone) => trimValue(phone?.wa_id || phone?.waId));
    const raw = trimValue(preferred?.wa_id || preferred?.waId);
    return raw ? digitsOnly(raw) : '';
  };

  const formatContactPhone = (contact) => {
    if (!contact || typeof contact !== 'object') return '';
    const phones = Array.isArray(contact.phones) ? contact.phones : [];
    const primary = phones.find((phone) => trimValue(phone?.phone || phone?.wa_id || phone?.waId));
    const raw = trimValue(primary?.phone || primary?.wa_id || primary?.waId);
    if (!raw) return '';
    return formatPhone(raw);
  };

  const contactHasWaId = (contact) => {
    if (!contact || typeof contact !== 'object') return false;
    const phones = Array.isArray(contact.phones) ? contact.phones : [];
    return phones.some((phone) => trimValue(phone?.wa_id || phone?.waId));
  };

  const resolveContactDigits = (contact) => {
    const waId = resolveContactWaId(contact);
    if (waId) return waId;
    const phone = formatContactPhone(contact);
    return digitsOnly(phone);
  };

  const getContactFirstName = (contact) => {
    const full = formatContactName(contact);
    if (full) return full.split(/\s+/).filter(Boolean)[0] || full;
    const phone = formatContactPhone(contact);
    return phone || 'Contato';
  };

  const buildContactsSummary = (contacts = []) => {
    if (!Array.isArray(contacts) || contacts.length < 2) return '';
    const firstName = getContactFirstName(contacts[0]);
    const count = contacts.length - 1;
    const otherLabel = count === 1 ? 'outro' : 'outros';
    const contactLabel = count === 1 ? 'contato' : 'contatos';
    return `${firstName} e ${count} ${otherLabel} ${contactLabel}`;
  };

  const buildContactsModalTitle = (count) => `${count} contato${count === 1 ? '' : 's'}`;

  const buildContactsModalRow = (contact = {}) => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm';

    const left = document.createElement('div');
    left.className = 'flex items-center gap-3 min-w-0';
    const avatar = document.createElement('div');
    avatar.className = 'h-10 w-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center';
    const avatarIcon = document.createElement('i');
    avatarIcon.className = 'fas fa-user';
    avatar.appendChild(avatarIcon);

    const info = document.createElement('div');
    info.className = 'min-w-0';
    const displayName = formatContactName(contact) || 'Contato compartilhado';
    const name = document.createElement('p');
    name.className = 'text-sm font-semibold text-gray-800 truncate';
    name.textContent = displayName;
    const phone = formatContactPhone(contact);
    const meta = document.createElement('div');
    meta.className = 'flex items-center gap-2';
    if (phone) {
      const phoneLine = document.createElement('p');
      phoneLine.className = 'text-xs text-gray-500 truncate';
      phoneLine.textContent = phone;
      meta.appendChild(phoneLine);
    }
    const type = document.createElement('span');
    type.className = 'text-[10px] font-semibold uppercase text-emerald-600';
    type.textContent = 'TEL';
    meta.appendChild(type);
    info.append(name, meta);

    left.append(avatar, info);

    const right = document.createElement('div');
    const waId = resolveContactDigits(contact);
    if (waId) {
      const chatButton = document.createElement('button');
      chatButton.type = 'button';
      chatButton.className = 'h-9 w-9 rounded-full border border-gray-200 text-gray-500 hover:border-primary hover:text-primary transition';
      const chatIcon = document.createElement('i');
      chatIcon.className = 'fas fa-comment';
      chatButton.appendChild(chatIcon);
      chatButton.addEventListener('click', () => {
        void openContactChat(waId, displayName);
        closeContactsModal();
      });
      right.appendChild(chatButton);
    }

    row.append(left, right);
    return row;
  };

  const renderContactsModalList = () => {
    if (!elements.contactsModalList || !elements.contactsModalEmpty || !elements.contactsModalTitle) return;
    elements.contactsModalList.innerHTML = '';
    const contacts = Array.isArray(state.contactsModalContacts) ? state.contactsModalContacts : [];
    if (!contacts.length) {
      elements.contactsModalEmpty.classList.remove('hidden');
      elements.contactsModalTitle.textContent = 'Contatos';
      return;
    }
    elements.contactsModalEmpty.classList.add('hidden');
    elements.contactsModalTitle.textContent = buildContactsModalTitle(contacts.length);
    const fragment = document.createDocumentFragment();
    contacts.forEach((contact) => {
      fragment.appendChild(buildContactsModalRow(contact));
    });
    elements.contactsModalList.appendChild(fragment);
  };

  const openContactsModal = (contacts) => {
    if (!elements.contactsModal) return;
    state.contactsModalContacts = Array.isArray(contacts) ? contacts : [];
    renderContactsModalList();
    setModalVisibility(elements.contactsModal, true);
  };

  const closeContactsModal = () => {
    if (!elements.contactsModal) return;
    setModalVisibility(elements.contactsModal, false);
    state.contactsModalContacts = [];
  };

  const buildGroupedContactsCard = (contacts, isOutgoing) => {
    const group = document.createElement('div');
    group.className = 'space-y-2';

    const summaryCard = document.createElement('div');
    summaryCard.className = `overflow-hidden rounded-xl border ${isOutgoing ? 'border-primary/20 bg-white/95' : 'border-gray-200 bg-white'} shadow-sm`;
    summaryCard.style.minWidth = '220px';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between gap-3 px-3 py-2';
    const left = document.createElement('div');
    left.className = 'flex items-center gap-2 min-w-0';
    const avatar = document.createElement('div');
    avatar.className = 'h-9 w-9 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center';
    const avatarIcon = document.createElement('i');
    avatarIcon.className = 'fas fa-user';
    avatar.appendChild(avatarIcon);

    const textWrap = document.createElement('div');
    textWrap.className = 'min-w-0';
    const summaryText = buildContactsSummary(contacts) || getContactFirstName(contacts[0]);
    const name = document.createElement('p');
    name.className = 'text-sm font-semibold text-gray-800 truncate';
    name.textContent = summaryText;
    textWrap.appendChild(name);

    left.append(avatar, textWrap);
    const arrow = document.createElement('i');
    arrow.className = 'fas fa-chevron-right text-gray-400 text-xs';
    header.append(left, arrow);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'w-full px-3 py-2 text-center text-sm font-semibold text-primary hover:bg-primary/10 transition';
    button.textContent = 'Ver todos';

    button.addEventListener('click', () => {
      openContactsModal(contacts);
    });

    summaryCard.append(header, button);
    group.append(summaryCard);
    return group;
  };

  const buildContactCard = (contact, isOutgoing) => {
    const card = document.createElement('div');
    card.className = `overflow-hidden rounded-xl border ${isOutgoing ? 'border-primary/20 bg-white/95' : 'border-gray-200 bg-white'} shadow-sm`;
    card.style.minWidth = '220px';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between gap-3 px-3 py-2';
    const left = document.createElement('div');
    left.className = 'flex items-center gap-2 min-w-0';
    const avatar = document.createElement('div');
    avatar.className = 'h-9 w-9 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center';
    const avatarIcon = document.createElement('i');
    avatarIcon.className = 'fas fa-user';
    avatar.appendChild(avatarIcon);
    const textWrap = document.createElement('div');
    textWrap.className = 'min-w-0';
    const displayName = formatContactName(contact) || 'Contato compartilhado';
    const name = document.createElement('p');
    name.className = 'text-sm font-semibold text-gray-800 truncate';
    name.textContent = displayName;
    textWrap.appendChild(name);
    const phone = formatContactPhone(contact);
    if (phone) {
      const phoneLine = document.createElement('p');
      phoneLine.className = 'text-[11px] text-gray-500 truncate';
      phoneLine.textContent = phone;
      textWrap.appendChild(phoneLine);
    }
    left.append(avatar, textWrap);
    const arrow = document.createElement('i');
    arrow.className = 'fas fa-chevron-right text-gray-400 text-xs';
    header.append(left, arrow);

    const divider = document.createElement('div');
    divider.className = 'h-px bg-gray-200/70';

    const actions = document.createElement('div');
    const hasWaId = contactHasWaId(contact);
    const contactWaId = resolveContactWaId(contact);
    actions.className = hasWaId
      ? 'grid grid-cols-2 divide-x divide-gray-200 text-center'
      : 'grid grid-cols-1 text-center';

    const actionButton = (label, action, data = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className =
        'py-2 text-[11px] font-semibold text-primary hover:bg-primary/10 transition';
      button.textContent = label;
      if (action) {
        button.dataset.contactAction = action;
      }
      if (data.waId) button.dataset.contactWaId = data.waId;
      if (data.name) button.dataset.contactName = data.name;
      return button;
    };

    if (hasWaId) {
      actions.appendChild(actionButton('Mensagem', 'message', { waId: contactWaId, name: displayName }));
      actions.appendChild(actionButton('Salvar contato'));
      void (async () => {
        try {
          const customer = await resolveCustomerByPhone(contactWaId);
          if (!customer) return;
          actions.innerHTML = '';
          actions.className = 'grid grid-cols-1 text-center';
          actions.appendChild(actionButton('Conversar', 'message', { waId: contactWaId, name: displayName }));
        } catch (error) {
          console.error('web-whatsapp:contact-card', error);
        }
      })();
    } else {
      actions.appendChild(actionButton('Convidar para o WhatsApp'));
    }

    card.append(header, divider, actions);
    return card;
  };

  const openContactChat = async (contactId, name, options = {}) => {
    const waId = digitsOnly(contactId);
    if (!waId) {
      notify('Contato sem numero de WhatsApp.', 'warning');
      return;
    }
    if (!state.selectedCompanyId || !state.selectedNumberId) {
      notify('Selecione uma empresa e um numero antes de iniciar conversa.', 'warning');
      return;
    }
    const previousContactId = state.selectedContactId;
    if (previousContactId === waId) return;

    stopAudioRecording(true);
    closeEmojiPopover();
    closeAttachPopover();
    closeChatMenuPopover();
    closeCustomerModals();
    closeProfilePanel();
    closeBusinessProfilePanel();

    if (previousContactId && previousContactId !== waId) {
      cleanupEmptyConversation(previousContactId);
    }

    state.selectedContactId = waId;
    const existing = state.contacts.find((entry) => entry.waId === waId);
    if (!existing) {
      state.contacts.unshift({
        waId,
        name: name || '',
        isKnownUser: Boolean(options.isKnownUser),
        phoneNumberId: state.selectedNumberId,
        lastMessage: '',
        lastMessageAt: null,
        lastDirection: '',
        lastMessageId: '',
        unreadCount: 0,
        lastReadAt: null,
      });
    } else {
      if (name && !existing.name) {
        existing.name = name;
      }
      if (options.isKnownUser && !existing.isKnownUser) {
        existing.isKnownUser = true;
      }
    }

    renderConversations();
    updateChatHeader();
    void hydrateContactIdentity(waId, name);
    await loadMessages();
    setSendState();
  };

  const deleteConversation = async () => {
    if (!state.selectedContactId) {
      notify('Selecione uma conversa.', 'warning');
      return;
    }
    if (!state.selectedCompanyId || !state.selectedNumberId) {
      notify('Selecione uma empresa e um numero conectado.', 'warning');
      return;
    }
    const confirmDelete = window.confirm('Deseja apagar esta conversa?');
    if (!confirmDelete) return;

    try {
      const url = new URL(
        `${API_BASE}/integrations/whatsapp/${state.selectedCompanyId}/conversations/${state.selectedContactId}`
      );
      url.searchParams.set('phoneNumberId', state.selectedNumberId);
      const resp = await fetch(url.toString(), {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.message || 'Nao foi possivel apagar a conversa.');
      }

      state.contacts = state.contacts.filter((entry) => entry.waId !== state.selectedContactId);
      state.messages = [];
      state.selectedContactId = '';
      rebuildMessageIds();
      closeProfilePanel();
      renderConversations();
      renderMessages();
      updateChatHeader();
      setSendState();
      notify('Conversa apagada.', 'success');
    } catch (error) {
      notify(error.message || 'Nao foi possivel apagar a conversa.', 'error');
    }
  };

  const renderMessages = () => {
    if (!elements.messages) return;
    elements.messages.innerHTML = '';

    if (!state.selectedContactId) {
      const empty = document.createElement('div');
      empty.className = 'h-full flex flex-col items-center justify-center text-center px-6';
      const icon = document.createElement('i');
      icon.className = 'fa-brands fa-whatsapp text-3xl text-emerald-500';
      const title = document.createElement('h2');
      title.className = 'mt-3 text-lg font-semibold text-gray-800';
      title.textContent = 'Web WhatsApp';
      const message = document.createElement('p');
      message.className = 'mt-2 text-sm text-gray-500 max-w-md';
      message.textContent = 'Bem vindo! Selecione uma conversa ao lado para visualizar o historico e enviar mensagens.';
      empty.appendChild(icon);
      empty.appendChild(title);
      empty.appendChild(message);
      elements.messages.appendChild(empty);
      return;
    }

    if (state.loadingMessages) {
      const loading = document.createElement('div');
      loading.className = 'rounded-lg border border-dashed border-gray-200 bg-white p-4 text-center text-xs text-gray-500';
      loading.textContent = 'Carregando mensagens...';
      elements.messages.appendChild(loading);
      return;
    }

    if (!state.messages.length) {
      const empty = document.createElement('div');
      empty.className = 'rounded-lg border border-dashed border-gray-200 bg-white p-4 text-center text-xs text-gray-500';
      empty.textContent = 'Nenhuma mensagem encontrada.';
      elements.messages.appendChild(empty);
      return;
    }

    let lastDayKey = '';
    state.messages.forEach((message) => {
      const createdAt = message.createdAt || '';
      const date = createdAt ? new Date(createdAt) : null;
      const dayKey = date && !Number.isNaN(date.getTime()) ? date.toDateString() : '';
      if (dayKey && dayKey !== lastDayKey) {
        const separator = document.createElement('div');
        separator.className = 'flex justify-center';
        const label = document.createElement('span');
        label.className = 'text-[11px] uppercase tracking-wide text-gray-500 bg-gray-100 px-3 py-1 rounded-full';
        label.textContent = formatDayLabel(date);
        separator.appendChild(label);
        elements.messages.appendChild(separator);
        lastDayKey = dayKey;
      }

      const isOutgoing = message.direction === 'outgoing';
      const media = message.media || null;
      const contacts = Array.isArray(message.contacts) ? message.contacts : [];
      const isContact = contacts.length > 0 || message.message === '[contato]';
      const isImage = (media && media.type === 'image') || trimValue(message.message) === '[imagem]';
      const isAudio = (media && media.type === 'audio') || message.message === '[voz]' || message.message === '[audio]';
      const isDocument = (media && media.type === 'document') || trimValue(message.message) === '[documento]';
      const wrapper = document.createElement('div');
      wrapper.className = isOutgoing ? 'flex items-end justify-end gap-2' : 'flex items-end gap-2';

      if (!isOutgoing && !isAudio && !isContact && !isDocument) {
        const avatar = document.createElement('img');
        avatar.src = '/public/image/placeholder.svg';
        avatar.alt = 'Cliente';
        avatar.className = 'h-8 w-8 rounded-full object-cover bg-gray-100';
        wrapper.appendChild(avatar);
      }

      const bubble = document.createElement('div');
      const bubbleToneClass = isOutgoing
        ? 'rounded-2xl rounded-br-md border border-primary/20 bg-primary/10 text-sm text-gray-700 shadow-sm'
        : 'rounded-2xl rounded-bl-md border border-gray-200 bg-white text-sm text-gray-700 shadow-sm';
      if (isDocument) {
        bubble.className = `w-[320px] max-w-[90%] ${bubbleToneClass} p-0 overflow-hidden`;
      } else if (isImage) {
        bubble.className = `max-w-[70%] ${bubbleToneClass} p-2`;
      } else {
        bubble.className = `max-w-[70%] ${bubbleToneClass} p-3`;
      }
      let appendMeta = true;
      if (isDocument) {
        appendMeta = false;
      }

      if (isContact) {
        bubble.classList.remove('p-3');
        bubble.classList.add('p-2');
      }

      const meta = document.createElement('div');
      meta.className = isDocument
        ? 'flex items-center justify-end gap-1 text-[10px] text-gray-400'
        : 'mt-2 flex items-center justify-end gap-1 text-[10px] text-gray-400';
      const time = document.createElement('span');
      time.textContent = formatTime(createdAt);
      meta.appendChild(time);

      if (isOutgoing) {
        const tickInfo = buildStatusTick(message.status);
        if (tickInfo) {
          const tick = document.createElement('i');
          tick.className = `fas ${tickInfo.icon} ${tickInfo.color}`;
          meta.appendChild(tick);
        }
      }

      if (isContact) {
        if (contacts.length > 1) {
          bubble.appendChild(buildGroupedContactsCard(contacts, isOutgoing));
        } else {
          const contactWrap = document.createElement('div');
          contactWrap.className = 'space-y-2';
          const list = contacts.length > 0 ? contacts : [{}];
          list.forEach((contact) => {
            contactWrap.appendChild(buildContactCard(contact, isOutgoing));
          });
          bubble.appendChild(contactWrap);
        }
      } else if (isImage) {
        const mediaId = trimValue(media?.id || media?.mediaId || '');
        let imageUrl = media?.r2Url || media?.url || '';
        if (!imageUrl && mediaId && state.mediaCache.has(mediaId)) {
          imageUrl = state.mediaCache.get(mediaId) || '';
        }

        const image = document.createElement('img');
        image.alt = 'Imagem';
        image.className = 'max-h-72 w-full rounded-xl object-cover bg-white';
        image.src = imageUrl || '/public/image/placeholder.svg';
        bubble.appendChild(image);

        const caption = trimValue(media?.caption || (trimValue(message.message) !== '[imagem]' ? message.message : ''));
        if (caption && caption !== '[imagem]') {
          const captionEl = document.createElement('p');
          captionEl.className = 'mt-2 text-sm text-gray-700';
          captionEl.textContent = caption;
          bubble.appendChild(captionEl);
        }

        const ensureImageUrl = async () => {
          if (imageUrl) return true;
          if (!mediaId) return false;
          try {
            const fetched = await fetchMediaBlobUrl(mediaId);
            if (fetched) {
              imageUrl = fetched;
              image.src = fetched;
              return true;
            }
          } catch (error) {
            console.error('web-whatsapp:image-fetch', error);
            notify(error.message || 'Nao foi possivel carregar a imagem.', 'error');
          }
          return false;
        };

        if (!imageUrl && mediaId) {
          void ensureImageUrl();
        }
        image.addEventListener('click', async () => {
          const ready = await ensureImageUrl();
          if (!ready || !imageUrl) return;
          window.open(imageUrl, '_blank', 'noopener');
        });
      } else if (isAudio) {
        const audioRow = document.createElement('div');
        audioRow.className = 'flex items-center gap-3';
        audioRow.style.minWidth = '220px';

        const playButton = document.createElement('button');
        playButton.type = 'button';
        playButton.className = `h-9 w-9 rounded-full border ${isOutgoing ? 'border-primary/40 text-primary' : 'border-gray-200 text-gray-500'} flex items-center justify-center bg-white shadow-sm`;
        const playIcon = document.createElement('i');
        playIcon.className = 'fas fa-play';
        playButton.appendChild(playIcon);

        const lineWrap = document.createElement('div');
        lineWrap.className = 'flex-1';
        lineWrap.style.minWidth = '120px';
        lineWrap.style.maxWidth = '240px';
        const wave = document.createElement('div');
        wave.className = 'flex items-center gap-1';
        const waveBars = createMessageWaveBars(wave, isOutgoing ? 'var(--color-primary)' : '#10b981');
        setMessageWaveIdle(waveBars);
        lineWrap.appendChild(wave);

        const avatarUrl = isOutgoing
          ? (state.businessProfile?.profile_picture_url || '/public/image/placeholder.svg')
          : '/public/image/placeholder.svg';
        const audioAvatar = document.createElement('img');
        audioAvatar.src = avatarUrl;
        audioAvatar.alt = isOutgoing ? 'Perfil' : 'Cliente';
        audioAvatar.className = 'h-9 w-9 rounded-full object-cover bg-gray-100';

        const audio = document.createElement('audio');
        const mediaId = trimValue(media?.id || media?.mediaId || '');
        let audioUrl = media?.r2Url || media?.url || '';
        let fallbackLoaded = false;
        if (!audioUrl && mediaId && state.mediaCache.has(mediaId)) {
          audioUrl = state.mediaCache.get(mediaId) || '';
        }
        if (audioUrl) {
          audio.src = audioUrl;
        } else if (!mediaId) {
          playButton.disabled = true;
          playButton.classList.add('opacity-50', 'cursor-not-allowed');
        }
        audio.preload = 'metadata';
        audio.className = 'hidden';

        const setPlaying = (playing) => {
          playIcon.className = `fas ${playing ? 'fa-pause' : 'fa-play'}`;
        };

        audio.addEventListener('play', () => {
          setPlaying(true);
          startMessageWaveAnimation(wave, waveBars);
        });
        audio.addEventListener('pause', () => {
          setPlaying(false);
          stopMessageWaveAnimation(wave, waveBars);
        });
        audio.addEventListener('ended', () => {
          setPlaying(false);
          stopMessageWaveAnimation(wave, waveBars);
          if (state.activeAudio === audio) {
            state.activeAudio = null;
          }
        });

        const ensureAudioSource = async (force = false) => {
          if (audioUrl && !force) return true;
          if (!mediaId) return false;
          try {
            audioUrl = await fetchMediaBlobUrl(mediaId);
            if (audioUrl) {
              audio.src = audioUrl;
              audio.load();
              playButton.disabled = false;
              playButton.classList.remove('opacity-50', 'cursor-not-allowed');
              fallbackLoaded = true;
              return true;
            }
          } catch (error) {
            console.error('web-whatsapp:audio-fetch', error);
            notify(error.message || 'Nao foi possivel carregar o audio.', 'error');
          }
          return false;
        };

        audio.addEventListener('error', () => {
          if (!fallbackLoaded && mediaId) {
            void ensureAudioSource(true);
          }
        });

        playButton.addEventListener('click', async () => {
          const ready = await ensureAudioSource();
          if (!ready) return;
          if (state.activeAudio && state.activeAudio !== audio) {
            state.activeAudio.pause();
          }
          state.activeAudio = audio;
          if (audio.paused) {
            const playPromise = audio.play();
            if (playPromise && typeof playPromise.catch === 'function') {
              playPromise.catch(() => {
                setPlaying(false);
                if (!fallbackLoaded && mediaId) {
                  void ensureAudioSource(true);
                }
              });
            }
          } else {
            audio.pause();
          }
        });

        audioRow.appendChild(playButton);
        audioRow.appendChild(lineWrap);
        audioRow.appendChild(audioAvatar);
        audioRow.appendChild(audio);
        bubble.appendChild(audioRow);
      } else if (isDocument) {
        const docHeader = document.createElement('div');
        docHeader.className = 'flex items-start gap-3 px-3 py-2';
        docHeader.style.minWidth = '220px';

        const docIconWrap = document.createElement('div');
        docIconWrap.className = `h-10 w-10 rounded-xl ${isOutgoing ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-500'} flex items-center justify-center`;
        const docIcon = document.createElement('i');
        docIcon.className = 'fas fa-file-lines';
        docIconWrap.appendChild(docIcon);

        const infoWrap = document.createElement('div');
        infoWrap.className = 'flex-1 min-w-0';
        const rawMessage = trimValue(message.message);
        const normalizedMessage = rawMessage.toLowerCase();
        const fileName =
          trimValue(media?.filename) ||
          (rawMessage && normalizedMessage !== '[documento]' ? rawMessage : '') ||
          'Documento';
        const nameLine = document.createElement('p');
        nameLine.className = 'text-sm font-semibold text-gray-800 truncate';
        nameLine.textContent = fileName;
        infoWrap.appendChild(nameLine);

        const fileMetaParts = [];
        const mimeType = trimValue(media?.mimeType);
        if (mimeType) fileMetaParts.push(mimeType);
        const fileSize = formatFileSize(media?.fileSize);
        if (fileSize) fileMetaParts.push(fileSize);
        if (fileMetaParts.length > 0) {
          const fileMeta = document.createElement('p');
          fileMeta.className = 'text-[11px] text-gray-500 truncate';
          fileMeta.textContent = fileMetaParts.join(' - ');
          infoWrap.appendChild(fileMeta);
        }

        const mediaId = trimValue(media?.id || media?.mediaId);
        let docUrl = media?.r2Url || media?.url || '';
        const hasStored = Boolean(trimValue(media?.r2Key || media?.r2Url));

        const ensureDocumentUrl = async (force = false) => {
          if (docUrl && !force) return docUrl;
          if (!mediaId) return '';
          try {
            docUrl = await fetchMediaBlobUrl(mediaId);
            if (docUrl) {
              return docUrl;
            }
          } catch (error) {
            console.error('web-whatsapp:document-fetch', error);
            notify(error.message || 'Nao foi possivel carregar o documento.', 'error');
          }
          return '';
        };

        const openDocument = async (download = false) => {
          const url = await ensureDocumentUrl();
          if (!url) return;
          const link = document.createElement('a');
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener';
          if (download) {
            link.download = fileName || 'documento';
          }
          document.body.appendChild(link);
          link.click();
          link.remove();
        };

        const rightWrap = document.createElement('div');
        rightWrap.className = 'flex flex-col items-end gap-2';

        if (hasStored) {
          rightWrap.appendChild(meta);
        } else {
          const downloadButton = document.createElement('button');
          downloadButton.type = 'button';
          downloadButton.className = `h-9 w-9 rounded-full border ${isOutgoing ? 'border-primary/40 text-primary' : 'border-gray-200 text-gray-500'} flex items-center justify-center bg-white shadow-sm`;
          const downloadIcon = document.createElement('i');
          downloadIcon.className = 'fas fa-download';
          downloadButton.appendChild(downloadIcon);

          if (!docUrl && !mediaId) {
            downloadButton.disabled = true;
            downloadButton.classList.add('opacity-50', 'cursor-not-allowed');
          }

          downloadButton.addEventListener('click', async () => {
            if (!mediaId) return;
            downloadButton.disabled = true;
            downloadButton.classList.add('opacity-60', 'cursor-not-allowed');
            downloadIcon.className = 'fas fa-spinner fa-spin';
            try {
              const storedMedia = await storeMediaInR2(mediaId);
              if (storedMedia) {
                message.media = { ...(message.media || {}), ...storedMedia };
                renderMessages();
                notify('Arquivo salvo no R2.', 'success');
              }
            } catch (error) {
              console.error('web-whatsapp:document-store', error);
              notify(error.message || 'Nao foi possivel salvar no R2.', 'error');
              downloadButton.disabled = false;
              downloadButton.classList.remove('opacity-60', 'cursor-not-allowed');
              downloadIcon.className = 'fas fa-download';
            }
          });

          rightWrap.appendChild(meta);
          rightWrap.appendChild(downloadButton);
        }

        docHeader.appendChild(docIconWrap);
        docHeader.appendChild(infoWrap);
        docHeader.appendChild(rightWrap);
        bubble.appendChild(docHeader);

        if (hasStored) {
          const actionsRow = document.createElement('div');
          actionsRow.className = `flex items-center divide-x ${isOutgoing ? 'border-t border-primary/15 bg-primary/5' : 'border-t border-gray-200 bg-gray-50'}`;

          const openButton = document.createElement('button');
          openButton.type = 'button';
          openButton.className = 'flex-1 px-3 py-2 text-[11px] font-semibold text-primary hover:text-primary/80 transition';
          openButton.textContent = 'Abrir';
          openButton.addEventListener('click', () => {
            void openDocument(false);
          });

          const saveButton = document.createElement('button');
          saveButton.type = 'button';
          saveButton.className = 'flex-1 px-3 py-2 text-[11px] font-semibold text-primary hover:text-primary/80 transition';
          saveButton.textContent = 'Salvar como...';
          saveButton.addEventListener('click', () => {
            void openDocument(true);
          });

          actionsRow.appendChild(openButton);
          actionsRow.appendChild(saveButton);
          bubble.appendChild(actionsRow);
        }

        let captionText = trimValue(media?.caption);
        if (!captionText && rawMessage && rawMessage !== fileName && normalizedMessage !== '[documento]') {
          captionText = rawMessage;
        }
        if (captionText && captionText !== fileName) {
          const captionLine = document.createElement('p');
          captionLine.className = 'px-3 pb-2 text-xs text-gray-500';
          captionLine.textContent = captionText;
          bubble.appendChild(captionLine);
        }
      } else {
        const text = document.createElement('p');
        text.textContent = message.message || '[mensagem]';
        bubble.appendChild(text);
      }
      if (appendMeta) {
        bubble.appendChild(meta);
      }
      wrapper.appendChild(bubble);
      elements.messages.appendChild(wrapper);
    });

    elements.messages.scrollTop = elements.messages.scrollHeight;
  };

  const loadConversations = async (options = {}) => {
    const silent = Boolean(options.silent);
    const skipMessages = Boolean(options.skipMessages);
    if (!API_BASE || !state.selectedCompanyId || !state.selectedNumberId) {
      if (!silent) {
        state.contacts = [];
        renderConversations();
        updateChatHeader();
        renderMessages();
      }
      return;
    }

    if (!silent) {
      state.loadingContacts = true;
      renderConversations();
    }

    let loaded = false;
    try {
      const url = new URL(`${API_BASE}/integrations/whatsapp/${state.selectedCompanyId}/conversations`);
      url.searchParams.set('phoneNumberId', state.selectedNumberId);
      const resp = await fetch(url.toString(), { headers: authHeaders(false) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao carregar conversas.');
      }
      const conversations = Array.isArray(data?.conversations) ? data.conversations : [];
      state.contacts = conversations.map(normalizeConversation);
      loaded = true;
    } catch (error) {
      console.error('web-whatsapp:conversations', error);
      if (!silent) {
        notify('Nao foi possivel carregar as conversas.', 'error');
        state.contacts = [];
      }
    }

    if (!silent) {
      state.loadingContacts = false;
    }

    if (loaded || !silent) {
      if (state.selectedContactId && !state.contacts.some((entry) => entry.waId === state.selectedContactId)) {
        state.selectedContactId = '';
        state.messages = [];
        rebuildMessageIds();
      }
      if (!state.selectedContactId && state.contacts.length > 0) {
        state.selectedContactId = '';
      }
      updateChatHeader();
      renderConversations();
      if (!skipMessages) {
        await loadMessages({ silent });
      }
      if (!silent) {
        setSendState();
      }
    }
  };

  const loadMessages = async (options = {}) => {
    const silent = Boolean(options.silent);
    if (!API_BASE || !state.selectedCompanyId || !state.selectedNumberId || !state.selectedContactId) {
      if (!silent) {
        state.messages = [];
        rebuildMessageIds();
        renderMessages();
      }
      return;
    }

    if (!silent) {
      state.loadingMessages = true;
      renderMessages();
    }

    let loaded = false;
    try {
      const url = new URL(`${API_BASE}/integrations/whatsapp/${state.selectedCompanyId}/conversations/${state.selectedContactId}/messages`);
      url.searchParams.set('phoneNumberId', state.selectedNumberId);
      const resp = await fetch(url.toString(), { headers: authHeaders(false) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao carregar mensagens.');
      }
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      state.messages = messages.map(normalizeMessage);
      rebuildMessageIds();
      syncContactStatusFromMessages();
      void markConversationRead(findLatestIncomingMessageId());
      loaded = true;
    } catch (error) {
      console.error('web-whatsapp:messages', error);
      if (!silent) {
        notify('Nao foi possivel carregar as mensagens.', 'error');
        state.messages = [];
        rebuildMessageIds();
      }
    }

    if (!silent) {
      state.loadingMessages = false;
    }
    if (loaded || !silent) {
      renderMessages();
    }
  };

  const applyContactStatus = (contact, status, messageId) => {
    if (!contact || !status) return false;
    if (messageId) {
      if (contact.lastMessageId && contact.lastMessageId !== messageId) return false;
      if (!contact.lastMessageId) {
        contact.lastMessageId = messageId;
      }
      contact.lastDirection = 'outgoing';
    } else if (contact.lastDirection !== 'outgoing') {
      return false;
    }
    if (contact.lastStatus === status) return false;
    contact.lastStatus = status;
    return true;
  };

  const syncContactStatusFromMessages = () => {
    const contact = state.contacts.find((entry) => entry.waId === state.selectedContactId);
    if (!contact || contact.lastDirection !== 'outgoing') return false;
    let target = null;
    if (contact.lastMessageId) {
      target = state.messages.find((entry) => entry.messageId === contact.lastMessageId) || null;
    }
    if (!target) {
      for (let i = state.messages.length - 1; i >= 0; i -= 1) {
        const entry = state.messages[i];
        if (entry?.direction === 'outgoing') {
          target = entry;
          break;
        }
      }
    }
    if (!target?.status) return false;
    const updated = applyContactStatus(contact, target.status, target.messageId);
    if (updated) {
      renderConversations();
      updateChatHeader();
    }
    return updated;
  };

  const updateConversationPreviewForContact = (waId, text, createdAt, options = {}) => {
    const contactId = waId || state.selectedContactId;
    if (!contactId) return;
    const contact = state.contacts.find((entry) => entry.waId === contactId);
    const status = options.status || '';
    const messageId = options.messageId || '';
    const phoneNumberId = options.phoneNumberId || state.selectedNumberId;
    if (contact) {
      contact.lastMessage = text;
      contact.lastMessageAt = createdAt;
      contact.lastDirection = 'outgoing';
      if (messageId) contact.lastMessageId = messageId;
      if (status) contact.lastStatus = status;
    } else {
      state.contacts.unshift({
        waId: contactId,
        name: '',
        phoneNumberId,
        lastMessage: text,
        lastMessageAt: createdAt,
        lastDirection: 'outgoing',
        lastMessageId: messageId || '',
        lastStatus: status || '',
        unreadCount: 0,
        lastReadAt: null,
      });
    }
    state.contacts.sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bTime - aTime;
    });
    renderConversations();
    updateChatHeader();
  };

  const updateConversationPreview = (text, createdAt, options = {}) => {
    updateConversationPreviewForContact(state.selectedContactId, text, createdAt, options);
  };

  const resolveAudioMimeType = () => {
    const candidates = [
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
    ];
    if (typeof MediaRecorder === 'undefined') return '';
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    }
    return '';
  };

  const stopAudioRecording = (discard = false) => {
    if (!state.mediaRecorder) {
      if (discard || state.recordingReady) {
        resetRecordingState();
      }
      return;
    }
    state.recordingDiscard = Boolean(discard);
    state.recordingPaused = false;
    try {
      if (state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
      }
    } catch (_) {
      // ignore
    }
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((track) => track.stop());
    }
    state.recording = false;
    stopRecordingTimer();
    stopWaveAnimation();
    detachRecordingAnalyser();
    updateRecordingControls();
    setSendState();
  };

  const startAudioRecording = async () => {
    if (state.recording || state.sending) return;
    if (!state.selectedCompanyId || !state.selectedNumberId || !state.selectedContactId) {
      notify('Selecione um numero e uma conversa antes de gravar.', 'warning');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      notify('Seu navegador nao suporta gravacao de audio.', 'warning');
      elements.audioInput?.click();
      return;
    }

    const mimeType = resolveAudioMimeType();
    if (!mimeType) {
      notify('Gravacao de voz nao suportada neste navegador. Use o envio de audio.', 'warning');
      elements.audioInput?.click();
      return;
    }

    try {
      if (state.recordingReady) {
        resetRecordingState();
      }
      if (elements.input) {
        elements.input.value = '';
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType });
      state.mediaRecorder = recorder;
      state.mediaStream = stream;
      state.recordedChunks = [];
      state.recording = true;
      state.recordingPaused = false;
      state.recordingReady = false;
      state.recordingMimeType = mimeType;
      state.recordingDiscard = false;
      state.recordingElapsedMs = 0;
      state.recordingStartedAt = 0;
      clearRecordingPlayback();
      const analyser = attachRecordingAnalyser(stream);
      if (analyser) {
        startWaveAnimation(analyser, 'recording');
      }
      startRecordingTimer();
      updateRecordingControls();
      setSendState();

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) {
          state.recordedChunks.push(event.data);
          if (state.recordingPaused && !state.recordingReady) {
            updatePausedPreview();
          }
        }
      });

      recorder.addEventListener('stop', () => {
        const chunks = state.recordedChunks.slice();
        const shouldDiscard = state.recordingDiscard;
        const recordedType = state.recordingMimeType || mimeType;
        stopRecordingTimer();
        state.mediaRecorder = null;
        state.mediaStream = null;
        state.recording = false;
        state.recordingPaused = false;
        if (shouldDiscard) {
          resetRecordingState();
          return;
        }
        if (!chunks.length) {
          notify('Gravacao vazia.', 'warning');
          resetRecordingState();
          return;
        }
        clearRecordingPlayback();
        const blob = new Blob(chunks, { type: recordedType });
        if (!blob.size) {
          notify('Gravacao vazia.', 'warning');
          resetRecordingState();
          return;
        }
        state.recordingBlob = blob;
        state.recordingReady = true;
        state.recordingUrl = URL.createObjectURL(blob);
        state.recordingAudio = new Audio(state.recordingUrl);
        state.recordingAudio.addEventListener('ended', updateRecordingControls);
        state.recordingAudio.addEventListener('pause', updateRecordingControls);
        state.recordingAudio.addEventListener('play', updateRecordingControls);
        const analyser = attachPlaybackAnalyser(state.recordingAudio);
        if (analyser) {
          state.recordingAudio.addEventListener('play', () => startWaveAnimation(analyser, 'playback'));
          state.recordingAudio.addEventListener('pause', () => stopWaveAnimation());
          state.recordingAudio.addEventListener('ended', () => stopWaveAnimation());
        }
        updateRecordingControls();
        setSendState();
      });

      recorder.addEventListener('error', () => {
        notify('Nao foi possivel gravar audio.', 'error');
        stopAudioRecording(true);
      });

      recorder.start();
      notify('Gravando audio... clique novamente para finalizar.', 'info');
    } catch (error) {
      console.error('web-whatsapp:record', error);
      notify('Nao foi possivel acessar o microfone.', 'error');
      resetRecordingState();
    }
  };

  const updatePausedPreview = () => {
    if (!state.recordingPaused || state.recordingReady) return;
    if (!state.recordedChunks.length) return;
    const recordedType = state.recordingMimeType || 'audio/webm';
    const blob = new Blob(state.recordedChunks, { type: recordedType });
    if (!blob.size) return;
    clearRecordingPlayback();
    state.recordingUrl = URL.createObjectURL(blob);
    state.recordingAudio = new Audio(state.recordingUrl);
    state.recordingAudio.addEventListener('ended', updateRecordingControls);
    state.recordingAudio.addEventListener('pause', updateRecordingControls);
    state.recordingAudio.addEventListener('play', updateRecordingControls);
    const analyser = attachPlaybackAnalyser(state.recordingAudio);
    if (analyser) {
      state.recordingAudio.addEventListener('play', () => startWaveAnimation(analyser, 'playback'));
      state.recordingAudio.addEventListener('pause', () => stopWaveAnimation());
      state.recordingAudio.addEventListener('ended', () => stopWaveAnimation());
    }
    updateRecordingControls();
  };

  const toggleRecordingPause = () => {
    if (!state.mediaRecorder || !state.recording) return;
    try {
      if (state.recordingPaused) {
        state.mediaRecorder.resume();
        state.recordingPaused = false;
        resumeRecordingTimer();
        clearRecordingPlayback();
        if (state.recordingAnalyser) {
          startWaveAnimation(state.recordingAnalyser, 'recording');
        }
      } else {
        state.mediaRecorder.pause();
        state.recordingPaused = true;
        pauseRecordingTimer();
        stopWaveAnimation();
        if (typeof state.mediaRecorder.requestData === 'function') {
          state.mediaRecorder.requestData();
        } else {
          updatePausedPreview();
        }
      }
      updateRecordingControls();
      setSendState();
    } catch (error) {
      console.error('web-whatsapp:record-pause', error);
      notify('Nao foi possivel pausar a gravacao.', 'error');
    }
  };

  const toggleRecordingPlayback = async () => {
    if (!state.recordingAudio) return;
    try {
      if (state.recordingAudio.paused) {
        await state.recordingAudio.play();
      } else {
        state.recordingAudio.pause();
      }
      updateRecordingControls();
    } catch (error) {
      console.error('web-whatsapp:record-play', error);
      notify('Nao foi possivel reproduzir o audio.', 'error');
    }
  };

  const sendRecordedAudio = async () => {
    if (!state.recordingReady || !state.recordingBlob) return;
    const mimeType = String(state.recordingBlob.type || 'audio/webm').toLowerCase();
    let ext = 'audio';
    if (mimeType.includes('ogg')) ext = 'ogg';
    else if (mimeType.includes('mp4')) ext = 'm4a';
    else if (mimeType.includes('mpeg')) ext = 'mp3';
    else if (mimeType.includes('webm')) ext = 'webm';
    const file = new File([state.recordingBlob], `audio-${Date.now()}.${ext}`, { type: mimeType });
    const queued = queueAudioSend(file, { forceVoice: true });
    if (queued) {
      resetRecordingState();
    }
  };

  const getAudioLabel = (file) => {
    if (!file) return '[audio]';
    const mimeType = String(file.type || '').toLowerCase();
    return mimeType === 'audio/ogg' ? '[voz]' : '[audio]';
  };

  const queueAudioSend = (file, options = {}) => {
    if (!file) return;
    if (!state.selectedCompanyId || !state.selectedNumberId || !state.selectedContactId) {
      notify('Selecione um numero e uma conversa antes de enviar.', 'warning');
      return false;
    }
    if (!file.type || !file.type.startsWith('audio/')) {
      notify('Selecione um arquivo de audio valido.', 'warning');
      return false;
    }
    if (file.size > AUDIO_MESSAGE_MAX_BYTES) {
      notify('O audio deve ter no maximo 16MB.', 'warning');
      return false;
    }
    if (state.audioSending) {
      notify('Aguarde o envio do audio atual.', 'warning');
      return false;
    }

    const forceVoice = options.forceVoice === true;
    const label = forceVoice ? '[voz]' : getAudioLabel(file);
    const createdAt = new Date().toISOString();
    const pendingId = `pending-audio-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    let localUrl = '';
    try {
      localUrl = URL.createObjectURL(file);
    } catch (_) {
      localUrl = '';
    }

    const pendingMessage = createPendingAudioMessage({
      file,
      label,
      createdAt,
      destination: state.selectedContactId,
      clientId: pendingId,
      localUrl,
    });
    if (state.selectedContactId === pendingMessage.destination) {
      state.messages.push(pendingMessage);
      renderMessages();
    }
    updateConversationPreviewForContact(pendingMessage.destination, label, createdAt, {
      status: pendingMessage.status,
      messageId: pendingMessage.messageId,
      phoneNumberId: state.selectedNumberId,
    });

    void sendAudio(file, {
      pendingId,
      destination: state.selectedContactId,
      phoneNumberId: state.selectedNumberId,
      companyId: state.selectedCompanyId,
      forceVoice,
      manageState: true,
    });
    return true;
  };

  const sendAudio = async (file, options = {}) => {
    if (!file) return false;
    const destinationId = options.destination || state.selectedContactId;
    const phoneNumberId = options.phoneNumberId || state.selectedNumberId;
    const companyId = options.companyId || state.selectedCompanyId;
    const pendingId = options.pendingId || '';
    const manageState = options.manageState !== false;
    if (!companyId || !phoneNumberId || !destinationId) {
      notify('Selecione um numero e uma conversa antes de enviar.', 'warning');
      return false;
    }
    if (!file.type || !file.type.startsWith('audio/')) {
      notify('Selecione um arquivo de audio valido.', 'warning');
      return false;
    }
    if (file.size > AUDIO_MESSAGE_MAX_BYTES) {
      notify('O audio deve ter no maximo 16MB.', 'warning');
      return false;
    }
    if (manageState && state.audioSending) return false;
    if (manageState) {
      state.audioSending = true;
    }

    const forceVoice = options.forceVoice === true;
    const label = forceVoice ? '[voz]' : getAudioLabel(file);
    const mimeType = String(file.type || '').toLowerCase();
    const voice = forceVoice || mimeType === 'audio/ogg';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('phoneNumberId', phoneNumberId);
    formData.append('destination', destinationId);
    formData.append('voice', voice ? 'true' : 'false');
    if (pendingId) formData.append('clientId', pendingId);

    let sent = false;
    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${companyId}/send-audio`, {
        method: 'POST',
        headers: authHeaders(false),
        body: formData,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao enviar audio.');
      }

      let log = data?.log ? normalizeMessage(data.log) : null;
      const createdAt = log?.createdAt || new Date().toISOString();
      let localUrl = '';
      const hasRemoteAudio = log?.media?.r2Url || log?.media?.url;
      if (!hasRemoteAudio) {
        try {
          localUrl = URL.createObjectURL(file);
        } catch (_) {
          localUrl = '';
        }
      }
      const fallbackMedia = localUrl
        ? {
            type: 'audio',
            direction: 'outgoing',
            url: localUrl,
          }
        : null;
      if (log && fallbackMedia) {
        log = {
          ...log,
          media: log.media
            ? { ...log.media, ...(log.media.r2Url || log.media.url ? {} : { url: fallbackMedia.url }) }
            : fallbackMedia,
        };
      }
      let messageToAdd = log || {
        id: '',
        direction: 'outgoing',
        status: 'Enviado',
        message: label,
        origin: '',
        destination: destinationId,
        messageId: '',
        createdAt,
        media: fallbackMedia,
      };

      if (pendingId && destinationId === state.selectedContactId) {
        const pendingMessage = state.messages.find((entry) => entry.clientId === pendingId);
        if (pendingMessage) {
          pendingMessage.status = log?.status || 'Enviado';
          pendingMessage.message = label;
          pendingMessage.createdAt = log?.createdAt || pendingMessage.createdAt || createdAt;
          pendingMessage.media = log?.media || pendingMessage.media || fallbackMedia;
          pendingMessage.messageId = log?.messageId || pendingMessage.messageId || '';
          if (pendingMessage.messageId) addMessageId(pendingMessage.messageId);
          updateConversationPreviewForContact(destinationId, pendingMessage.message, pendingMessage.createdAt, {
            status: pendingMessage.status,
            messageId: pendingMessage.messageId,
            phoneNumberId,
          });
          renderMessages();
          messageToAdd = null;
        }
      }

      if (log?.messageId) {
        addMessageId(log.messageId);
        const existing = state.messages.find((entry) => entry.messageId === log.messageId);
        if (existing) {
          existing.status = log.status || existing.status;
          existing.message = log.message || existing.message;
          existing.createdAt = log.createdAt || existing.createdAt;
          if (log.media) {
            if (!existing.media) {
              existing.media = log.media;
            } else {
              existing.media = {
                ...existing.media,
                ...(existing.media.r2Url || existing.media.url ? {} : { r2Url: log.media.r2Url, url: log.media.url }),
                ...(existing.media.id ? {} : { id: log.media.id }),
                ...(existing.media.type ? {} : { type: log.media.type }),
              };
            }
          }
          updateConversationPreviewForContact(destinationId, existing.message, existing.createdAt || createdAt, {
            status: existing.status,
            messageId: existing.messageId,
            phoneNumberId,
          });
          renderMessages();
          messageToAdd = null;
        }
      }

      if (messageToAdd && destinationId === state.selectedContactId) {
        state.messages.push(messageToAdd);
        updateConversationPreviewForContact(destinationId, messageToAdd.message, messageToAdd.createdAt || createdAt, {
          status: messageToAdd.status,
          messageId: messageToAdd.messageId,
          phoneNumberId,
        });
        renderMessages();
      } else if (messageToAdd) {
        updateConversationPreviewForContact(destinationId, messageToAdd.message, messageToAdd.createdAt || createdAt, {
          status: messageToAdd.status,
          messageId: messageToAdd.messageId,
          phoneNumberId,
        });
      }
      sent = true;
    } catch (error) {
      console.error('web-whatsapp:send-audio', error);
      if (pendingId && destinationId === state.selectedContactId) {
        const pendingMessage = state.messages.find((entry) => entry.clientId === pendingId);
        if (pendingMessage) {
          pendingMessage.status = 'Erro';
          updateConversationPreviewForContact(destinationId, pendingMessage.message, pendingMessage.createdAt, {
            status: pendingMessage.status,
            messageId: pendingMessage.messageId,
            phoneNumberId,
          });
          renderMessages();
        }
      }
      notify(error.message || 'Nao foi possivel enviar o audio.', 'error');
    } finally {
      if (manageState) {
        state.audioSending = false;
      }
    }

    return sent;
  };

  const sendMessage = async () => {
    if (state.sending) return;
    const text = elements.input?.value.trim() || '';
    if (!text) return;
    if (!state.selectedCompanyId || !state.selectedNumberId || !state.selectedContactId) {
      notify('Selecione um numero e uma conversa antes de enviar.', 'warning');
      return;
    }

    state.sending = true;
    setSendState();

    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${state.selectedCompanyId}/send-message`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          phoneNumberId: state.selectedNumberId,
          destination: state.selectedContactId,
          message: text,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao enviar mensagem.');
      }
      const log = data?.log ? normalizeMessage(data.log) : null;
      const createdAt = log?.createdAt || new Date().toISOString();
      if (log?.messageId) {
        addMessageId(log.messageId);
        const existing = state.messages.find((entry) => entry.messageId === log.messageId);
        if (existing) {
          existing.status = log.status || existing.status;
          existing.message = log.message || existing.message;
          existing.createdAt = log.createdAt || existing.createdAt;
          updateConversationPreview(existing.message || text, existing.createdAt || createdAt, {
            status: existing.status || log?.status,
            messageId: existing.messageId || log?.messageId,
          });
          elements.input.value = '';
          renderMessages();
          return;
        }
      }

      state.messages.push(
        log || {
          id: '',
          direction: 'outgoing',
          status: 'Enviado',
          message: text,
          origin: '',
          destination: state.selectedContactId,
          messageId: '',
          createdAt,
        }
      );
      updateConversationPreview(text, createdAt, {
        status: log?.status || 'Enviado',
        messageId: log?.messageId,
      });
      elements.input.value = '';
      renderMessages();
    } catch (error) {
      console.error('web-whatsapp:send', error);
      notify(error.message || 'Nao foi possivel enviar a mensagem.', 'error');
    } finally {
      state.sending = false;
      setSendState();
    }
  };

  const sendImage = async (file, captionOverride = null, options = {}) => {
    const manageState = options?.skipState !== true;
    const pendingId = options?.pendingId;
    const destinationId = options?.destination || state.selectedContactId;
    const phoneNumberId = options?.phoneNumberId || state.selectedNumberId;
    const companyId = options?.companyId || state.selectedCompanyId;
    if (state.sending && manageState) return false;
    if (!file) return false;
    if (!companyId || !phoneNumberId || !destinationId) {
      notify('Selecione um numero e uma conversa antes de enviar.', 'warning');
      return false;
    }
    if (!isSupportedImageFile(file)) {
      notify('Selecione uma imagem valida.', 'warning');
      return false;
    }
    if (file.size > IMAGE_MESSAGE_MAX_BYTES) {
      notify('A imagem deve ter no maximo 5MB.', 'warning');
      return false;
    }

    if (manageState) {
      state.sending = true;
      setSendState();
    }

    const useCaption =
      typeof captionOverride === 'string'
        ? trimValue(captionOverride)
        : trimValue(elements.input?.value || '');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('phoneNumberId', phoneNumberId);
    formData.append('destination', destinationId);
    if (useCaption) formData.append('caption', useCaption);
    formData.append('filename', file.name || 'imagem');
    if (pendingId) formData.append('clientId', pendingId);
    let sent = false;

    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${companyId}/send-image`, {
        method: 'POST',
        headers: authHeaders(false),
        body: formData,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao enviar imagem.');
      }

      const log = data?.log ? normalizeMessage(data.log) : null;
      const createdAt = log?.createdAt || new Date().toISOString();
      const messageLabel = log?.message || useCaption || '[imagem]';
      const mediaPayload = log?.media || {
        type: 'image',
        filename: file.name || 'imagem',
        mimeType: file.type || '',
        direction: 'outgoing',
        caption: useCaption,
      };
      let messageToAdd = null;

      if (log?.messageId) {
        addMessageId(log.messageId);
        const existing = state.messages.find((entry) => entry.messageId === log.messageId);
        if (existing) {
          existing.status = log.status || existing.status;
          existing.message = log.message || existing.message;
          existing.createdAt = log.createdAt || existing.createdAt;
          existing.media = log.media || existing.media || mediaPayload;
          updateConversationPreviewForContact(destinationId, messageLabel, existing.createdAt || createdAt, {
            status: existing.status,
            messageId: existing.messageId,
            phoneNumberId,
          });
          if (captionOverride === null && elements.input) {
            elements.input.value = '';
          }
          if (destinationId === state.selectedContactId) {
            renderMessages();
          }
          messageToAdd = null;
        } else {
          messageToAdd = log;
        }
      } else {
        messageToAdd = log || {
          id: '',
          direction: 'outgoing',
          status: 'Enviado',
          message: messageLabel,
          origin: '',
          destination: destinationId,
          messageId: '',
          createdAt,
          media: mediaPayload,
        };
      }

      if (pendingId && destinationId === state.selectedContactId) {
        const pendingMessage = state.messages.find((entry) => entry.clientId === pendingId);
        if (pendingMessage) {
          const previousUrl = trimValue(pendingMessage.media?.url || '');
          pendingMessage.status = log?.status || 'Enviado';
          pendingMessage.message = messageLabel;
          pendingMessage.createdAt = log?.createdAt || pendingMessage.createdAt || createdAt;
          pendingMessage.media = log?.media || pendingMessage.media || mediaPayload;
          pendingMessage.messageId = log?.messageId || pendingMessage.messageId || '';
          if (pendingMessage.messageId) addMessageId(pendingMessage.messageId);
          if (previousUrl && previousUrl.startsWith('blob:')) {
            const nextUrl = trimValue(pendingMessage.media?.r2Url || pendingMessage.media?.url || '');
            if (nextUrl && nextUrl !== previousUrl) {
              URL.revokeObjectURL(previousUrl);
            }
          }
          updateConversationPreviewForContact(destinationId, messageLabel, pendingMessage.createdAt, {
            status: pendingMessage.status,
            messageId: pendingMessage.messageId,
            phoneNumberId,
          });
          renderMessages();
          messageToAdd = null;
        }
      }

      if (messageToAdd && destinationId === state.selectedContactId) {
        state.messages.push(messageToAdd);
        updateConversationPreviewForContact(destinationId, messageLabel, messageToAdd.createdAt || createdAt, {
          status: messageToAdd.status,
          messageId: messageToAdd.messageId,
          phoneNumberId,
        });
        if (captionOverride === null && elements.input) {
          elements.input.value = '';
        }
        renderMessages();
      } else if (messageToAdd && destinationId !== state.selectedContactId) {
        updateConversationPreviewForContact(destinationId, messageLabel, messageToAdd.createdAt || createdAt, {
          status: messageToAdd.status,
          messageId: messageToAdd.messageId,
          phoneNumberId,
        });
      }
      sent = true;
    } catch (error) {
      console.error('web-whatsapp:send-image', error);
      if (pendingId && destinationId === state.selectedContactId) {
        const pendingMessage = state.messages.find((entry) => entry.clientId === pendingId);
        if (pendingMessage) {
          pendingMessage.status = 'Erro';
          updateConversationPreviewForContact(destinationId, pendingMessage.message, pendingMessage.createdAt, {
            status: pendingMessage.status,
            messageId: pendingMessage.messageId,
            phoneNumberId,
          });
          renderMessages();
        }
      }
      notify(error.message || 'Nao foi possivel enviar a imagem.', 'error');
    } finally {
      if (manageState) {
        state.sending = false;
        setSendState();
      }
    }

    return sent;
  };

  const sendDocument = async (file, captionOverride = null, options = {}) => {
    const manageState = options?.skipState !== true;
    const pendingId = options?.pendingId;
    const destinationId = options?.destination || state.selectedContactId;
    const phoneNumberId = options?.phoneNumberId || state.selectedNumberId;
    const companyId = options?.companyId || state.selectedCompanyId;
    if (state.sending && manageState) return false;
    if (!file) return;
    if (!companyId || !phoneNumberId || !destinationId) {
      notify('Selecione um numero e uma conversa antes de enviar.', 'warning');
      return false;
    }

    if (manageState) {
      state.sending = true;
      setSendState();
    }

    const useCaption =
      typeof captionOverride === 'string'
        ? trimValue(captionOverride)
        : trimValue(elements.input?.value || '');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('phoneNumberId', phoneNumberId);
    formData.append('destination', destinationId);
    if (useCaption) formData.append('caption', useCaption);
    formData.append('filename', file.name || 'documento');
    if (pendingId) formData.append('clientId', pendingId);
    let sent = false;

    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${companyId}/send-document`, {
        method: 'POST',
        headers: authHeaders(false),
        body: formData,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao enviar documento.');
      }

      const log = data?.log ? normalizeMessage(data.log) : null;
      const createdAt = log?.createdAt || new Date().toISOString();
      const messageLabel = log?.message || useCaption || file.name || '[documento]';
      const mediaPayload = log?.media || {
        type: 'document',
        filename: file.name || 'documento',
        mimeType: file.type || '',
        direction: 'outgoing',
      };
      let messageToAdd = null;

      if (log?.messageId) {
        addMessageId(log.messageId);
        const existing = state.messages.find((entry) => entry.messageId === log.messageId);
        if (existing) {
          existing.status = log.status || existing.status;
          existing.message = log.message || existing.message;
          existing.createdAt = log.createdAt || existing.createdAt;
          existing.media = log.media || existing.media || mediaPayload;
          updateConversationPreviewForContact(destinationId, messageLabel, existing.createdAt || createdAt, {
            status: existing.status,
            messageId: existing.messageId,
            phoneNumberId,
          });
          if (captionOverride === null && elements.input) {
            elements.input.value = '';
          }
          if (destinationId === state.selectedContactId) {
            renderMessages();
          }
          messageToAdd = null;
        } else {
          messageToAdd = log;
        }
      } else {
        messageToAdd = log || {
          id: '',
          direction: 'outgoing',
          status: 'Enviado',
          message: messageLabel,
          origin: '',
          destination: destinationId,
          messageId: '',
          createdAt,
          media: mediaPayload,
        };
      }

      if (pendingId && destinationId === state.selectedContactId) {
        const pendingMessage = state.messages.find((entry) => entry.clientId === pendingId);
        if (pendingMessage) {
          pendingMessage.status = log?.status || 'Enviado';
          pendingMessage.message = messageLabel;
          pendingMessage.createdAt = log?.createdAt || pendingMessage.createdAt || createdAt;
          pendingMessage.media = log?.media || pendingMessage.media || mediaPayload;
          pendingMessage.messageId = log?.messageId || pendingMessage.messageId || '';
          if (pendingMessage.messageId) addMessageId(pendingMessage.messageId);
          updateConversationPreviewForContact(destinationId, messageLabel, pendingMessage.createdAt, {
            status: pendingMessage.status,
            messageId: pendingMessage.messageId,
            phoneNumberId,
          });
          renderMessages();
          messageToAdd = null;
        }
      }

      if (messageToAdd && destinationId === state.selectedContactId) {
        if (!messageToAdd.media) {
          messageToAdd.media = mediaPayload;
        }
        state.messages.push(messageToAdd);
        updateConversationPreviewForContact(destinationId, messageLabel, messageToAdd.createdAt || createdAt, {
          status: messageToAdd.status,
          messageId: messageToAdd.messageId,
          phoneNumberId,
        });
        if (captionOverride === null && elements.input) {
          elements.input.value = '';
        }
        renderMessages();
      } else if (messageToAdd && destinationId !== state.selectedContactId) {
        updateConversationPreviewForContact(destinationId, messageLabel, messageToAdd.createdAt || createdAt, {
          status: messageToAdd.status,
          messageId: messageToAdd.messageId,
          phoneNumberId,
        });
      }
      sent = true;
    } catch (error) {
      console.error('web-whatsapp:send-document', error);
      if (pendingId && destinationId === state.selectedContactId) {
        const pendingMessage = state.messages.find((entry) => entry.clientId === pendingId);
        if (pendingMessage) {
          pendingMessage.status = 'Erro';
          updateConversationPreviewForContact(destinationId, pendingMessage.message, pendingMessage.createdAt, {
            status: pendingMessage.status,
            messageId: pendingMessage.messageId,
            phoneNumberId,
          });
          renderMessages();
        }
      }
      notify(error.message || 'Nao foi possivel enviar o documento.', 'error');
    } finally {
      if (manageState) {
        state.sending = false;
        setSendState();
      }
      return sent;
    }
  };

  const sendSharedContacts = async () => {
    if (state.shareContactsSending) return;
    if (!state.selectedCompanyId || !state.selectedNumberId || !state.selectedContactId) {
      notify('Selecione um numero e uma conversa antes de enviar.', 'warning');
      return;
    }
    const contacts = Array.from(state.shareContactsSelected.values());
    if (!contacts.length) return;

    state.shareContactsSending = true;
    updateShareContactsFooter();

    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${state.selectedCompanyId}/send-contacts`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          phoneNumberId: state.selectedNumberId,
          destination: state.selectedContactId,
          contacts,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao enviar contatos.');
      }

      const log = data?.log ? normalizeMessage(data.log) : null;
      const createdAt = log?.createdAt || new Date().toISOString();
      const messageLabel = log?.message || (contacts.length === 1 ? 'Contato compartilhado' : `${contacts.length} contatos compartilhados`);
      const messageContacts = log?.contacts || buildLocalShareContactsPayload(contacts);

      if (log?.messageId) {
        addMessageId(log.messageId);
        const existing = state.messages.find((entry) => entry.messageId === log.messageId);
        if (existing) {
          existing.status = log.status || existing.status;
          existing.message = log.message || existing.message;
          existing.createdAt = log.createdAt || existing.createdAt;
          existing.contacts = messageContacts;
          updateConversationPreview(messageLabel, existing.createdAt || createdAt, {
            status: existing.status || log?.status,
            messageId: existing.messageId || log?.messageId,
          });
          renderMessages();
          closeShareContactsModal();
          return;
        }
      }

      state.messages.push(
        log || {
          id: '',
          direction: 'outgoing',
          status: 'Enviado',
          message: messageLabel,
          origin: '',
          destination: state.selectedContactId,
          messageId: '',
          createdAt,
          contacts: messageContacts,
        }
      );
      updateConversationPreview(messageLabel, createdAt, {
        status: log?.status || 'Enviado',
        messageId: log?.messageId,
      });
      renderMessages();
      closeShareContactsModal();
    } catch (error) {
      console.error('web-whatsapp:send-contacts', error);
      notify(error.message || 'Nao foi possivel enviar os contatos.', 'error');
    } finally {
      state.shareContactsSending = false;
      updateShareContactsFooter();
    }
  };

  const setSendState = () => {
    if (!elements.input || !elements.sendButton) return;
    const hasText = elements.input.value.trim().length > 0;
    const canChat = Boolean(state.selectedContactId && state.selectedNumberId);
    const hasRecordingReady = state.recordingReady && !hasText;

    const micIcon = elements.sendButton.querySelector('[data-icon-mic]');
    const sendIcon = elements.sendButton.querySelector('[data-icon-send]');
    if (state.recording || state.recordingPaused) {
      if (micIcon) {
        micIcon.classList.add('hidden');
        micIcon.style.display = 'none';
        micIcon.setAttribute('aria-hidden', 'true');
      }
      if (sendIcon) {
        sendIcon.classList.remove('hidden');
        sendIcon.style.display = 'inline-flex';
        sendIcon.setAttribute('aria-hidden', 'false');
      }
      elements.sendButton.classList.add('bg-primary', 'border-primary', 'text-white');
      elements.sendButton.classList.remove('bg-white', 'border-gray-200', 'text-gray-600');
      elements.sendButton.setAttribute('aria-label', 'Finalizar gravacao');
      elements.sendButton.disabled = !canChat || state.sending;
      elements.sendButton.classList.toggle('opacity-60', !canChat || state.sending);
      elements.input.disabled = true;
      elements.input.classList.add('opacity-70', 'cursor-not-allowed');
      return;
    }

    if (micIcon) {
      const showMic = !hasText && !hasRecordingReady;
      micIcon.classList.toggle('hidden', !showMic);
      micIcon.style.display = showMic ? 'inline-flex' : 'none';
      micIcon.setAttribute('aria-hidden', showMic ? 'false' : 'true');
    }
    if (sendIcon) {
      const showSend = hasText || hasRecordingReady;
      sendIcon.classList.toggle('hidden', !showSend);
      sendIcon.style.display = showSend ? 'inline-flex' : 'none';
      sendIcon.setAttribute('aria-hidden', showSend ? 'false' : 'true');
    }

    elements.sendButton.classList.toggle('bg-primary', hasText || hasRecordingReady);
    elements.sendButton.classList.toggle('border-primary', hasText || hasRecordingReady);
    elements.sendButton.classList.toggle('text-white', hasText || hasRecordingReady);
    elements.sendButton.classList.toggle('bg-white', !hasText && !hasRecordingReady);
    elements.sendButton.classList.toggle('border-gray-200', !hasText && !hasRecordingReady);
    elements.sendButton.classList.toggle('text-gray-600', !hasText && !hasRecordingReady);
    elements.sendButton.setAttribute('aria-label', hasText ? 'Enviar mensagem' : hasRecordingReady ? 'Enviar audio' : 'Enviar audio');
    elements.sendButton.disabled = !canChat || state.sending;
    elements.sendButton.classList.toggle('opacity-60', !canChat || state.sending);
    elements.input.disabled = hasRecordingReady;
    elements.input.classList.toggle('opacity-70', hasRecordingReady);
    elements.input.classList.toggle('cursor-not-allowed', hasRecordingReady);
  };

  const bindEvents = () => {
    elements.companySelect?.addEventListener('change', async (event) => {
      state.selectedCompanyId = event.target.value;
      state.selectedNumberId = '';
      state.selectedContactId = '';
      state.contacts = [];
      state.messages = [];
      rebuildMessageIds();
      state.customerLookupCache.clear();
      state.customerPetsCache.clear();
      state.customerAddressCache.clear();
      stopAudioRecording(true);
      closeEmojiPopover();
      closeAttachPopover();
      closeChatMenuPopover();
      closeCustomerModals();
      closeBusinessProfilePanel();
      await loadNumbersForCompany(state.selectedCompanyId);
      await loadConversations();
      setSendState();
    });

    elements.numberSelect?.addEventListener('change', async (event) => {
      state.selectedNumberId = event.target.value;
      state.selectedContactId = '';
      state.contacts = [];
      state.messages = [];
      rebuildMessageIds();
      state.customerLookupCache.clear();
      state.customerPetsCache.clear();
      state.customerAddressCache.clear();
      stopAudioRecording(true);
      closeEmojiPopover();
      closeAttachPopover();
      closeChatMenuPopover();
      closeCustomerModals();
      closeBusinessProfilePanel();
      updateSelectedNumber();
      await ensureSocket();
      syncSocketRoom();
      await loadConversations();
      setSendState();
    });

    elements.conversations?.addEventListener('click', async (event) => {
      const target = event.target.closest('button[data-wa-id]');
      if (!target) return;
      const waId = target.dataset.waId;
      const previousContactId = state.selectedContactId;
      if (!waId || waId === previousContactId) return;
      if (previousContactId) {
        cleanupEmptyConversation(previousContactId);
      }
      state.selectedContactId = waId;
      stopAudioRecording(true);
      closeEmojiPopover();
      closeAttachPopover();
      closeChatMenuPopover();
      closeCustomerModals();
      clearSelectedUnread();
      updateChatHeader();
      renderConversations();
      void hydrateContactIdentity(waId);
      await loadMessages();
      setSendState();
    });

    elements.messages?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-contact-action="message"]');
      if (!button) return;
      const waId = button.dataset.contactWaId || '';
      const name = button.dataset.contactName || '';
      event.preventDefault();
      event.stopPropagation();
      void openContactChat(waId, name);
    });

    const chatDropTarget = elements.chatPanel || elements.messages;
    if (chatDropTarget) {
      chatDropTarget.addEventListener('dragenter', (event) => {
        if (!event.dataTransfer?.types?.includes('Files')) return;
        event.preventDefault();
        state.dragCounter += 1;
        setDropzoneActive(true);
      });
      chatDropTarget.addEventListener('dragover', (event) => {
        if (!event.dataTransfer?.types?.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDropzoneActive(true);
      });
      chatDropTarget.addEventListener('dragleave', (event) => {
        if (!event.dataTransfer?.types?.includes('Files')) return;
        event.preventDefault();
        state.dragCounter = Math.max(0, state.dragCounter - 1);
        if (state.dragCounter === 0) {
          setDropzoneActive(false);
        }
      });
      chatDropTarget.addEventListener('drop', (event) => {
        if (!event.dataTransfer?.files?.length) return;
        event.preventDefault();
        state.dragCounter = 0;
        setDropzoneActive(false);
        const files = Array.from(event.dataTransfer.files);
        openFilePreview(files, { append: isFilePreviewOpen() });
      });
    }

    elements.searchInput?.addEventListener('input', (event) => {
      state.searchTerm = event.target.value || '';
      renderConversations();
    });

    elements.chatName?.addEventListener('click', toggleProfilePanel);
    elements.chatTags?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-chat-tag]');
      if (!button) return;
      const tag = button.dataset.chatTag || '';
      if (tag === 'pets') {
        void openPetsModal();
        return;
      }
      if (tag === 'addresses') {
        void openAddressModal();
      }
    });
    elements.profileClose?.addEventListener('click', closeProfilePanel);
    elements.deleteConversationButton?.addEventListener('click', deleteConversation);
    elements.myProfileButton?.addEventListener('click', toggleBusinessProfilePanel);
    elements.businessProfileClose?.addEventListener('click', closeBusinessProfilePanel);
    elements.businessProfileEdit?.addEventListener('click', () => setBusinessProfileEditing(true));
    elements.businessProfileCancel?.addEventListener('click', () => {
      setBusinessProfileForm(state.businessProfile || {});
      setBusinessProfileEditing(false);
    });
    elements.businessProfileSave?.addEventListener('click', saveBusinessProfile);
    elements.businessProfileAvatarInput?.addEventListener('change', (event) => {
      const file = event.target?.files?.[0];
      if (!file) return;
      void uploadBusinessProfilePicture(file);
      event.target.value = '';
    });

    elements.input?.addEventListener('input', setSendState);

    elements.input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (elements.input.value.trim()) {
          sendMessage();
        }
      }
    });

    elements.sendButton?.addEventListener('click', () => {
      closeEmojiPopover();
      closeAttachPopover();
      closeChatMenuPopover();
      if (elements.input?.value.trim()) {
        sendMessage();
        return;
      }
      if (state.recording || state.recordingPaused) {
        stopAudioRecording(false);
        return;
      }
      if (state.recordingReady) {
        void sendRecordedAudio();
        return;
      }
      void startAudioRecording();
    });

    elements.audioInput?.addEventListener('change', (event) => {
      const file = event.target?.files?.[0];
      if (!file) return;
      closeAttachPopover();
      closeChatMenuPopover();
      queueAudioSend(file);
      event.target.value = '';
    });

    elements.mediaInput?.addEventListener('change', (event) => {
      const files = Array.from(event.target?.files || []);
      if (!files.length) return;
      closeAttachPopover();
      closeChatMenuPopover();
      openFilePreview(files, { append: isFilePreviewOpen() });
      event.target.value = '';
    });

    elements.documentInput?.addEventListener('change', (event) => {
      const files = Array.from(event.target?.files || []);
      if (!files.length) return;
      closeAttachPopover();
      closeChatMenuPopover();
      openFilePreview(files, { append: isFilePreviewOpen() });
      event.target.value = '';
    });

    elements.filePreviewClose?.addEventListener('click', closeFilePreview);
    elements.filePreviewAdd?.addEventListener('click', () => {
      elements.documentInput?.click();
    });
    elements.filePreviewModal?.addEventListener('click', (event) => {
      if (event.target === elements.filePreviewModal) closeFilePreview();
    });
    elements.filePreviewSend?.addEventListener('click', () => {
      void sendFilePreview();
    });
    elements.filePreviewCaption?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void sendFilePreview();
      }
    });
    elements.filePreviewCaption?.addEventListener('input', (event) => {
      const entry = state.filePreviewItems[state.filePreviewIndex];
      if (!entry) return;
      entry.caption = event.target?.value || '';
    });

    elements.recordingToggle?.addEventListener('click', toggleRecordingPause);
    elements.recordingCancel?.addEventListener('click', () => {
      if (state.recording || state.recordingPaused) {
        stopAudioRecording(true);
        return;
      }
      resetRecordingState();
    });
    elements.recordingPlay?.addEventListener('click', () => {
      void toggleRecordingPlayback();
    });

    elements.emojiButton?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleEmojiPopover();
    });

    elements.attachButton?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleAttachPopover();
    });

    elements.chatMenuButton?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleChatMenuPopover();
    });

    elements.newConversationButton?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void openNewConversationModal();
    });
    elements.newConversationClose?.addEventListener('click', closeNewConversationModal);
    elements.newConversationModal?.addEventListener('click', (event) => {
      if (event.target === elements.newConversationModal) closeNewConversationModal();
    });
    elements.newConversationSearch?.addEventListener('input', scheduleNewConversationSearch);
    elements.newConversationList?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-contact-wa-id]');
      if (!button) return;
      const waId = button.dataset.contactWaId || '';
      const name = button.dataset.contactName || '';
      const isKnownUser = button.dataset.knownUser === '1';
      closeNewConversationModal();
      void openContactChat(waId, name, { isKnownUser });
    });

    elements.shareContactsClose?.addEventListener('click', closeShareContactsModal);
    elements.shareContactsModal?.addEventListener('click', (event) => {
      if (event.target === elements.shareContactsModal) closeShareContactsModal();
    });
    elements.shareContactsSearch?.addEventListener('input', scheduleShareContactsSearch);
    elements.shareContactsList?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-share-contact-id]');
      if (!button) return;
      const waId = button.dataset.shareContactId || '';
      const name = button.dataset.shareContactName || '';
      const phone = button.dataset.shareContactPhone || '';
      toggleShareContactSelection(waId, name, phone);
    });
    elements.shareContactsSend?.addEventListener('click', () => {
      void sendSharedContacts();
    });
    elements.contactsModalClose?.addEventListener('click', closeContactsModal);
    elements.contactsModal?.addEventListener('click', (event) => {
      if (event.target === elements.contactsModal) closeContactsModal();
    });

    elements.petsModalClose?.addEventListener('click', closePetsModal);
    elements.petsModal?.addEventListener('click', (event) => {
      if (event.target === elements.petsModal) closePetsModal();
    });
    elements.addressModalClose?.addEventListener('click', closeAddressModal);
    elements.addressModal?.addEventListener('click', (event) => {
      if (event.target === elements.addressModal) closeAddressModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closePetsModal();
        closeAddressModal();
        closeNewConversationModal();
        closeShareContactsModal();
        closeContactsModal();
      }
    });
  };

  state.emojiRecent = loadEmojiRecents();
  bindEvents();
  setSendState();
  updateRecordingControls();
  loadCompanies().then(loadConversations);
});
