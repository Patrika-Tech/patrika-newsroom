// Minimal bilingual dictionary. Add keys as the app grows.
export const dict = {
  en: {
    appName: 'Patrika Newsroom Intelligence',
    tagline: 'AI-Powered Monitoring & Analytics',
    login: 'Sign In', logout: 'Sign Out', role: 'Role', edition: 'Edition',
    username: 'Username', password: 'Password', signingIn: 'Signing in…',
    search: 'Search…', allEditions: 'All Editions',
    nav: {
      home: 'Home Dashboard', editorial: 'Editorial', production: 'Production',
      pages: 'Page Monitoring', hr: 'HR', legal: 'Legal', archive: 'Archive',
      ai: 'AI Insights', alerts: 'Alerts Center', reports: 'Reports', tasks: 'Task Management', correspondent: 'Correspondent', 'news-generator': 'News Generator', feedback: 'Feedback', settings: 'Settings'
    },
    kpi: {
      pages: 'Pages Published', delayed: 'Delayed Editions', productivity: 'Reporter Productivity',
      quality: 'Content Quality', adratio: 'Ad Ratio', legal: 'Pending Legal Cases', hr: 'HR Alerts'
    },
    common: {
      today: 'Today', thisWeek: 'This Week', save: 'Save', cancel: 'Cancel',
      add: 'Add', export: 'Export', status: 'Status', priority: 'Priority',
      reporter: 'Reporter', score: 'Score', noData: 'No data yet'
    }
  },
  hi: {
    appName: 'पत्रिका न्यूज़रूम इंटेलिजेंस',
    tagline: 'एआई-संचालित निगरानी और एनालिटिक्स',
    login: 'साइन इन', logout: 'साइन आउट', role: 'भूमिका', edition: 'संस्करण',
    username: 'उपयोगकर्ता नाम', password: 'पासवर्ड', signingIn: 'साइन इन हो रहा है…',
    search: 'खोजें…', allEditions: 'सभी संस्करण',
    nav: {
      home: 'मुख्य डैशबोर्ड', editorial: 'संपादकीय', production: 'प्रोडक्शन',
      pages: 'पेज मॉनिटरिंग', hr: 'एचआर', legal: 'कानूनी', archive: 'आर्काइव',
      ai: 'एआई इनसाइट्स', alerts: 'अलर्ट सेंटर', reports: 'रिपोर्ट्स', tasks: 'टास्क मैनेजमेंट', correspondent: 'संवाददाता', 'news-generator': 'न्यूज़ जनरेटर', feedback: 'फीडबैक', settings: 'सेटिंग्स'
    },
    kpi: {
      pages: 'प्रकाशित पृष्ठ', delayed: 'विलंबित संस्करण', productivity: 'रिपोर्टर उत्पादकता',
      quality: 'कंटेंट गुणवत्ता', adratio: 'विज्ञापन अनुपात', legal: 'लंबित कानूनी मामले', hr: 'एचआर अलर्ट'
    },
    common: {
      today: 'आज', thisWeek: 'इस सप्ताह', save: 'सहेजें', cancel: 'रद्द करें',
      add: 'जोड़ें', export: 'निर्यात', status: 'स्थिति', priority: 'प्राथमिकता',
      reporter: 'रिपोर्टर', score: 'स्कोर', noData: 'अभी कोई डेटा नहीं'
    }
  }
};

export function tr(lang, path) {
  return path.split('.').reduce((o, k) => (o ? o[k] : undefined), dict[lang]) ?? path;
}
