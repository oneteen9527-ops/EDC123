import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
i18n.use(initReactI18next).init({
  lng: 'zh',
  resources: {
    zh: { translation: { welcome: '风力发电投资基金平台', login: '登录', register: '注册' } },
    en: { translation: { welcome: 'Wind Investment Fund', login: 'Login', register: 'Register' } }
  }
});
