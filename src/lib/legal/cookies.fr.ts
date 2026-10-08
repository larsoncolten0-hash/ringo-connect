import type { LegalDoc } from "./types";

// Version française de cookies.en.ts : mêmes sections et même contenu. Aucune affirmation sur la nécessité juridique d'un consentement.
export const cookiesFr: LegalDoc = {
  title: "Politique relative aux cookies",
  description: "Les cookies et le stockage du navigateur utilisés par Ringo Connect, leur finalité et leur durée.",
  updated: "8 octobre 2026",
  intro: [
    "Cette page liste les cookies et stockages similaires du navigateur (stockage local et stockage de session) que Ringo Connect utilise aujourd'hui. Elle fait partie de notre Politique de confidentialité et sera mise à jour lorsque le produit évolue.",
  ],
  sections: [
    {
      id: "essential",
      title: "1. Nécessaires au fonctionnement du service",
      blocks: [
        { p: "Ils vous gardent connecté et permettent à des fonctions comme le paiement de marcher. Sans eux, une partie de Ringo ne fonctionnerait pas." },
        {
          ul: [
            "**Cookies de session de connexion** posés par notre prestataire d'authentification (Supabase) pendant qu'un titulaire de compte est connecté.",
            "**Cookie de session client** (`ringo_customer`, ou `__Host-ringo_customer` en production) pour les clients connectés à leur espace client Ringo. Il dure jusqu'à l'expiration de cette session.",
            "**Cookie d'organisation active** (`ringo_active_org`) : retient l'organisation dans laquelle travaille un membre d'équipe. Il dure jusqu'à 365 jours.",
            "**Cookie d'activité** (`rc_active_ping`) : cookie de courte durée, sans valeur personnelle, qui limite la fréquence d'enregistrement de l'activité d'un compte. Il dure 5 minutes.",
            "**Rappel de paiement d'inscription** (`rc_signup_pay`, stockage local) : conserve l'identifiant d'un paiement d'inscription en cours pour pouvoir le reprendre après un rechargement. Conservé jusqu'à 3 heures.",
          ],
        },
      ],
    },
    {
      id: "preferences",
      title: "2. Mémorisation de vos choix",
      blocks: [
        { p: "Ils enregistrent des préférences uniquement sur votre appareil." },
        {
          ul: [
            "Langue (`ringo-lang`), thème (`ringo-theme`) et son (`ringo-sound`).",
            "Préférences et thème du lecteur de musique (`ringo-player-prefs`, `ringo-player-theme`) et un petit cache utilisé par le lecteur (`ringo-peaks:v1:…`).",
            "Les invitations que vous avez fermées, par exemple l'ajout à l'écran d'accueil, les notifications et les conseils du tableau de bord (`ringo-a2hs-dismissed-…`, `ringo-push-prompt-dismissed`, `ringo-push-resume`, `ringo-guidance-dismissed:…`).",
            "L'étape de la visite guidée atteinte (`ringo-onboarding-tour-step`, stockage de session, effacé à la fermeture de l'onglet).",
          ],
        },
      ],
    },
    {
      id: "referrals",
      title: "3. Liens de parrainage et d'ambassadeur",
      blocks: [
        { p: "Si vous arrivez par un lien du programme d'affiliation (`rc_ref`) ou du programme Ambassadeur (`rc_amb`), le code est conservé dans le stockage local de votre navigateur jusqu'à 60 jours afin de pouvoir être crédité si vous vous inscrivez. Ce sont deux programmes distincts et deux clés distinctes." },
      ],
    },
    {
      id: "measurement",
      title: "4. Statistiques mesurées par Ringo",
      blocks: [
        { p: "Les statistiques de visites et de clics d'une page Ringo sont enregistrées par Ringo lui-même dans sa propre base de données (la page, l'heure, le site d'origine et un pays et une ville approximatifs). Elles n'utilisent pas d'identifiant par cookie. Un marqueur de session du navigateur (`ringo-session-pinged`, stockage de session) limite la fréquence à laquelle une session de l'application installée est signalée pour les titulaires de compte connectés." },
      ],
    },
    {
      id: "advertising",
      title: "5. Identifiants de visiteur et pixels publicitaires",
      blocks: [
        { p: "Ringo peut permettre à un propriétaire de page ayant une offre éligible d'enregistrer un pixel Meta (Facebook) ou TikTok dans ses paramètres. **Actuellement, Ringo ne charge pas ces pixels sur les pages publiques, n'envoie aucun événement à Meta ou TikTok à ce titre, et ne pose pas l'identifiant de visiteur (`ringo_vid`) ni l'identifiant de clic TikTok (`ringo_ttclid`) qui servaient à faire correspondre ces événements.**" },
        { p: "Lorsqu'une page Ringo publique est ouverte, Ringo supprime ces cookies (`ringo_vid`, `ringo_ttclid`, `_fbp`, `_fbc`, `_ttp`) s'ils ont été laissés dans votre navigateur par une visite antérieure. Si cela change à l'avenir, cette page et la Politique de confidentialité seront mises à jour avant." },
      ],
    },
    {
      id: "providers",
      title: "6. Autres sites",
      blocks: [
        { p: "Lorsque vous êtes redirigé vers un autre prestataire, par exemple pour payer, vous connecter avec Google ou Apple, ou ouvrir WhatsApp, les règles de cookies propres à ce prestataire s'appliquent à ses pages." },
      ],
    },
    {
      id: "control",
      title: "7. Gérer les cookies et le stockage",
      blocks: [
        { p: "Vous pouvez supprimer les cookies et les données de site dans les paramètres de votre navigateur, ou les bloquer. Dans ce cas, vous pouvez être déconnecté, vos préférences enregistrées seront réinitialisées et certaines fonctions peuvent cesser de fonctionner." },
      ],
    },
    {
      id: "contact",
      title: "8. Contact",
      blocks: [{ p: "Questions sur cette page : info@ringoconnectltd.com." }],
    },
  ],
};
