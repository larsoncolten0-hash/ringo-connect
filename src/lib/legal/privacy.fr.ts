import type { LegalDoc } from "./types";

// Version française de privacy.en.ts : mêmes sections, même contenu.
export const privacyFr: LegalDoc = {
  title: "Politique de confidentialité",
  description: "Comment Ringo Connect collecte, utilise et protège les informations personnelles : comptes, pages publiques, paiements, notifications, cookies et plus encore.",
  updated: "8 octobre 2026",
  intro: [
    "Cette Politique de confidentialité explique comment Ringo Connect traite les informations personnelles. Ringo Connect est exploité par Ringo Connect Ltd. (Yaoundé, Cameroun) (« Ringo », « nous »). Elle décrit ce que le produit fait aujourd'hui et sera mise à jour à mesure que le produit évolue.",
    "Ringo est utilisé par des propriétaires de pages (créateurs, artistes, entreprises) et par leurs visiteurs et clients. Lorsqu'un propriétaire de page collecte des informations auprès de ses propres clients via sa page Ringo, c'est lui qui décide pourquoi elles sont collectées ; Ringo fournit la plateforme qu'il utilise.",
  ],
  sections: [
    {
      id: "who-we-are",
      title: "1. Qui sommes-nous",
      blocks: [
        { p: "Ringo Connect est exploité par Ringo Connect Ltd., Yaoundé, Cameroun. Vous pouvez nous joindre à info@ringoconnectltd.com." },
      ],
    },
    {
      id: "information-you-provide",
      title: "2. Informations que vous nous fournissez",
      blocks: [
        { p: "**Compte.** Votre adresse e-mail et votre mot de passe lorsque vous créez un compte, ou votre nom et votre e-mail si vous vous connectez avec Google ou Apple. Votre mot de passe est géré par notre prestataire d'authentification et n'est pas conservé par Ringo sous une forme lisible." },
        { p: "**Votre page.** Tout ce que vous ajoutez à votre page Ringo : nom, présentation, photos, liens, réseaux sociaux, numéros de téléphone et WhatsApp, lieu et horaires, produits et prix, plats du menu, musique, événements et contenus similaires." },
        { p: "**Messages envoyés.** Ce que vous nous écrivez lorsque vous nous contactez ou demandez de l'aide." },
      ],
    },
    {
      id: "information-collected-automatically",
      title: "3. Informations collectées automatiquement",
      blocks: [
        { p: "**Visites des pages publiques.** Lorsque quelqu'un ouvre une page Ringo ou touche un lien, un produit ou le bouton WhatsApp, nous enregistrons cet événement avec la page, l'heure, le site d'origine et un pays et une ville approximatifs déduits de la requête. C'est ainsi que les propriétaires de pages voient leurs statistiques." },
        { p: "**Données techniques.** Comme tout service web, nous traitons les adresses IP et des informations sur le navigateur pour afficher les pages, prévenir les abus et garantir la sécurité du service." },
        { p: "**Activité des comptes connectés.** Pour les titulaires de compte, nous enregistrons la date de dernière activité du compte et si l'application installée (écran d'accueil) est utilisée, afin de comprendre et d'assister l'usage du produit." },
      ],
    },
    {
      id: "public-profile-information",
      title: "4. Informations du profil public",
      blocks: [
        { p: "Une page Ringo est publique par nature. Tout ce que vous y mettez peut être vu par toute personne disposant du lien, d'un code QR ou d'une Ringo Connect Smart Card, et peut apparaître dans les moteurs de recherche. Ne publiez que des informations que vous acceptez de rendre publiques." },
      ],
    },
    {
      id: "uploaded-content",
      title: "5. Contenus téléversés",
      blocks: [
        { p: "Les images, l'audio et les fichiers que vous téléversez sont stockés chez notre prestataire de stockage. Les images utilisées sur les pages publiques sont diffusées publiquement. Les fichiers vendus (par exemple des chansons complètes ou des produits numériques) sont conservés dans un stockage privé et ne sont remis qu'aux personnes qui les ont payés." },
      ],
    },
    {
      id: "contact-information",
      title: "6. Coordonnées d'autres personnes",
      blocks: [
        { p: "Selon l'usage d'une page, Ringo conserve les coordonnées des personnes qui interagissent avec elle : clients qui passent une commande, font une réservation ou achètent un billet (nom, téléphone, e-mail si fourni, détails de la commande) ; personnes qui rejoignent la communauté d'une page ou s'y connectent (nom, téléphone, e-mail, préférences de notification) ; membres d'équipe invités par un propriétaire de compte (nom, e-mail, téléphone, rôle). Ces informations appartiennent à la page à laquelle elles ont été confiées et ne sont pas visibles par les autres titulaires de compte Ringo." },
        { p: "Les communications commerciales ne sont envoyées qu'aux personnes qui y ont consenti, et elles peuvent se désabonner à tout moment." },
      ],
    },
    {
      id: "account-authentication",
      title: "7. Informations de compte et d'authentification",
      blocks: [
        { p: "Nous utilisons des sessions (conservées dans des cookies) pour vous garder connecté, et envoyons des e-mails pour confirmer les adresses, réinitialiser les mots de passe et inviter des membres d'équipe. Les clients qui se connectent à leur propre espace client Ringo reçoivent une session distincte." },
      ],
    },
    {
      id: "payments",
      title: "8. Informations de paiement et de transaction",
      blocks: [
        { p: "Nous enregistrons les commandes et les paiements : ce qui a été acheté, les montants, le statut, la référence du prestataire de paiement et, pour le Mobile Money, le numéro de téléphone auquel la demande de paiement a été envoyée. Nous ne conservons pas les numéros de carte complets. Nous conservons aussi les informations nécessaires pour calculer et verser les soldes aux propriétaires de pages et, le cas échéant, les commissions d'affiliation et d'ambassadeur." },
      ],
    },
    {
      id: "fapshi-stripe",
      title: "9. Fapshi et Stripe",
      blocks: [
        { p: "Les paiements et versements Mobile Money sont traités par Fapshi. Les paiements par carte sont traités par Stripe. Lorsque vous payez, les informations nécessaires au paiement sont échangées avec le prestataire concerné, dont les propres pratiques de confidentialité s'appliquent également." },
      ],
    },
    {
      id: "orders-commerce",
      title: "10. Commandes et commerce",
      blocks: [
        { p: "Lorsqu'un client achète sur une page, le propriétaire de la page reçoit les informations de commande nécessaires pour l'exécuter (nom du client, coordonnées, articles, informations de livraison le cas échéant). Ringo conserve les enregistrements de commandes et de stock, et peut envoyer des confirmations de commande et des reçus par e-mail." },
      ],
    },
    {
      id: "music-digital",
      title: "11. Musique et produits numériques",
      blocks: [
        { p: "Les auditeurs peuvent écouter un court aperçu d'un titre avant de l'acheter. Les achats sont enregistrés dans la commande afin que l'acheteur puisse accéder à ce qu'il a acheté et recevoir un reçu. Les artistes qui vendent de la musique fournissent des informations de versement (par exemple un numéro Mobile Money) pour recevoir leurs gains." },
      ],
    },
    {
      id: "restaurant",
      title: "12. Restaurants et commandes de repas",
      blocks: [
        { p: "Les pages de restaurants peuvent afficher un menu et recevoir des commandes. Les commandes contiennent le nom du client, son numéro de téléphone et ce qui a été commandé, et sont visibles par l'équipe de ce restaurant. Des messages sur l'état de la commande peuvent être envoyés par e-mail ou par notification." },
      ],
    },
    {
      id: "events-bookings",
      title: "13. Événements, billets et réservations",
      blocks: [
        { p: "Les achats de billets créent des billets avec un code et un pass QR pouvant être scanné lors de l'événement. Les réservations conservent les informations saisies par le client (par exemple nom, coordonnées, service et horaire choisis) afin que le propriétaire de la page puisse les confirmer et les gérer. Des confirmations peuvent être envoyées par e-mail." },
      ],
    },
    {
      id: "ambassador",
      title: "14. Programmes d'affiliation et d'ambassadeurs",
      blocks: [
        { p: "Si vous suivez un lien de parrainage ou d'ambassadeur, le code est conservé dans votre navigateur pendant 60 jours au plus afin de pouvoir être crédité si vous vous inscrivez. Les participants à ces programmes fournissent des informations de versement, et nous enregistrons les parrainages, les commissions et les versements." },
      ],
    },
    {
      id: "whatsapp",
      title: "15. WhatsApp",
      blocks: [
        { p: "Les boutons WhatsApp d'une page ouvrent WhatsApp sur votre appareil ; ce que vous y écrivez est traité par WhatsApp selon ses propres conditions et sa propre politique de confidentialité. Lorsqu'un propriétaire de compte connecte un numéro WhatsApp Business à la messagerie de Ringo, Ringo traite les messages et les numéros de téléphone des personnes qui écrivent à ce numéro, afin de les montrer au propriétaire et de lui permettre de répondre (y compris par des réponses automatiques ou assistées par IA si le propriétaire les active)." },
      ],
    },
    {
      id: "smart-card-qr",
      title: "16. Ringo Connect Smart Card et codes QR",
      blocks: [
        { p: "Un code QR ou une Ringo Connect Smart Card ouvre la page publique du propriétaire. L'ouverture est enregistrée comme toute autre visite de la page (voir la section 3). Certains programmes, comme la fidélité ou les adhésions, utilisent des codes liés à la fiche d'un membre, de la façon décrite aux sections 6 et 10." },
      ],
    },
    {
      id: "push-notifications",
      title: "17. Notifications push",
      blocks: [
        { p: "Si vous choisissez d'activer les notifications push, nous conservons les informations techniques d'abonnement fournies par votre navigateur ou appareil et les utilisons pour envoyer des notifications via le service push de votre navigateur. Vous pouvez désactiver les notifications à tout moment dans l'application ou dans les paramètres de votre navigateur." },
      ],
    },
    {
      id: "analytics",
      title: "18. Statistiques et visites de pages",
      blocks: [
        { p: "Les statistiques de visites et de clics sont collectées par Ringo lui-même et stockées dans notre propre base de données (voir la section 3) ; nous n'utilisons pas de service d'analyse tiers pour cela. Les propriétaires voient ces statistiques pour leur propre page." },
        { p: "Ringo permet aux propriétaires de pages ayant une offre éligible d'enregistrer un pixel Meta (Facebook) ou TikTok dans leurs paramètres. Actuellement, Ringo ne charge pas ces pixels sur les pages publiques et n'envoie aucun événement à Meta ou TikTok à ce titre. Si cela change, la présente politique et la Politique relative aux cookies seront mises à jour au préalable." },
      ],
    },
    {
      id: "ringo-ai",
      title: "19. Ringo AI",
      blocks: [
        { p: "Ringo AI est un assistant destiné aux titulaires de compte. Ce que vous lui écrivez, les images que vous joignez et les informations limitées sur votre espace Ringo nécessaires pour répondre (par exemple des nombres et des réglages) sont envoyés au fournisseur d'IA configuré par Ringo (actuellement Anthropic ou OpenAI) pour produire une réponse. Les conversations sont enregistrées dans votre compte. Merci de ne pas saisir d'informations personnelles sensibles dans Ringo AI." },
      ],
    },
    {
      id: "cookies",
      title: "20. Cookies et stockage local",
      blocks: [
        { p: "Ringo utilise des cookies et un stockage similaire dans le navigateur pour vous garder connecté, retenir vos choix, créditer les parrainages et faire fonctionner le paiement. La liste complète, avec la finalité et la durée de chaque élément, figure dans notre [Politique relative aux cookies](/cookies)." },
        { p: "En résumé : des cookies de session de connexion et de session client, un cookie pour l'organisation dans laquelle travaille un membre d'équipe et un court cookie d'activité sont nécessaires au service ; la langue, le thème, le son, le lecteur de musique et les invitations fermées sont conservés sur votre appareil ; et un code de parrainage ou d'ambassadeur est conservé dans votre navigateur jusqu'à 60 jours." },
        { p: "Ringo ne pose actuellement aucun identifiant publicitaire ou de suivi des visiteurs et ne charge pas de pixels Meta ou TikTok sur les pages publiques. Lorsqu'une page publique est ouverte, Ringo supprime tout identifiant de ce type laissé par une visite antérieure. Ringo n'affiche actuellement pas de bannière de cookies." },
      ],
    },
    {
      id: "third-parties",
      title: "21. Services tiers et sous-traitants",
      blocks: [
        { p: "Nous faisons appel aux prestataires suivants pour faire fonctionner Ringo. Ils traitent des données pour notre compte ou, lorsque c'est indiqué, lorsque vous ou un propriétaire de page choisissez de les utiliser :" },
        {
          ul: [
            "Supabase : base de données, authentification et stockage de fichiers.",
            "Vercel : hébergement de l'application.",
            "Fapshi : paiements et versements Mobile Money.",
            "Stripe : paiements par carte pour les offres.",
            "Resend : envoi d'e-mails (reçus, confirmations, invitations et annonces).",
            "Meta : messagerie WhatsApp Business, si un propriétaire la connecte.",
            "Google et Apple : connexion, si vous choisissez de les utiliser.",
            "Anthropic et OpenAI : Ringo AI.",
            "Services de notifications push des navigateurs (par exemple ceux de Google, Apple et Mozilla) : envoi des notifications que vous avez activées.",
          ],
        },
        { p: "Chaque prestataire a aussi ses propres pratiques de confidentialité. Le prestataire qui traite les demandes de Ringo AI est un paramètre que Ringo peut modifier." },
      ],
    },
    {
      id: "how-we-use",
      title: "22. Comment nous utilisons les informations",
      blocks: [
        { p: "Pour gérer votre compte et votre page ; traiter les commandes, réservations, billets, paiements et versements ; envoyer des reçus, des confirmations et d'autres messages liés à ce que vous avez fait sur Ringo ; envoyer des messages commerciaux ou communautaires aux personnes qui y ont consenti ; montrer leurs statistiques aux propriétaires de pages ; fournir Ringo AI ; assurer la sécurité du service et prévenir la fraude et les abus ; vous assister ; et respecter nos obligations légales." },
      ],
    },
    {
      id: "retention",
      title: "23. Durée de conservation",
      blocks: [
        { p: "Nous conservons les informations personnelles aussi longtemps que nécessaire pour fournir Ringo, puis lorsque nous en avons besoin à des fins légales, comptables, de sécurité et de règlement de litiges. Certains aspects de notre conservation des données et de nos obligations légales peuvent dépendre de la loi applicable et de nos exigences opérationnelles, et nous n'indiquons pas ici de durées fixes pour les commandes, les fiches clients, les paiements, les statistiques de clics ou les journaux." },
        { p: "Quelques limites précises s'appliquent : un code de parrainage ou d'ambassadeur est conservé dans votre navigateur jusqu'à 60 jours ; la référence d'un paiement d'inscription en cours est conservée dans votre navigateur jusqu'à 3 heures ; et les comptes de démonstration sont supprimés automatiquement après 7 jours." },
      ],
    },
    {
      id: "security",
      title: "24. Sécurité des données",
      blocks: [
        { p: "Nous utilisons des contrôles d'accès et des restrictions au niveau de la base de données pour que chaque titulaire de compte n'accède qu'à ses propres données, nous chiffrons les connexions, et nous chiffrons certains secrets (comme les identifiants de prestataires de paiement et les jetons d'API marketing) au repos. Aucun service en ligne n'est parfaitement sûr. Si nous avons connaissance d'une violation touchant vos informations personnelles, nous en informerons les personnes concernées dans les meilleurs délais lorsque la loi l'exige." },
      ],
    },
    {
      id: "account-deletion",
      title: "25. Fermeture du compte et demandes de suppression",
      blocks: [
        { p: "Il n'existe pas actuellement de bouton « supprimer mon compte » en libre-service. Pour nous demander de fermer votre compte ou de supprimer vos informations, écrivez à info@ringoconnectltd.com. Les demandes sont traitées par notre équipe et nous ne pouvons pas promettre un délai précis." },
        { p: "La fermeture d'un compte n'entraîne pas nécessairement l'effacement de tout. Nous pouvons devoir conserver certaines informations, comme les enregistrements de commandes, de paiements, de versements et de sécurité, lorsque nous en avons besoin à des fins légales, comptables, de sécurité ou de règlement de litiges." },
      ],
    },
    {
      id: "your-rights",
      title: "26. Vos choix en matière de confidentialité",
      blocks: [
        { p: "Vous pouvez nous demander d'accéder aux informations personnelles que nous détenons sur vous, de les corriger ou de les supprimer, ou nous faire part d'une préoccupation sur leur utilisation, en écrivant à info@ringoconnectltd.com. Nous examinerons votre demande conformément à la loi applicable. Si vous êtes client d'un propriétaire de page, nous pouvons devoir impliquer ce propriétaire." },
      ],
    },
    {
      id: "international",
      title: "27. Traitement à l'international",
      blocks: [
        { p: "Nos prestataires peuvent stocker ou traiter des informations dans des pays autres que celui où vous vivez, y compris hors du Cameroun, selon le prestataire. Les conditions et pratiques de confidentialité propres à chaque prestataire s'appliquent à son traitement." },
      ],
    },
    {
      id: "children",
      title: "28. Enfants",
      blocks: [
        { p: "Ringo ne s'adresse pas aux enfants. Si nous apprenons que nous avons collecté des informations personnelles d'un enfant d'une manière qui n'aurait pas dû l'être, nous prendrons des mesures pour les supprimer." },
      ],
    },
    {
      id: "changes",
      title: "29. Modifications de cette politique",
      blocks: [
        { p: "Nous pouvons mettre à jour cette politique lorsque le produit ou la loi évolue. La date en haut de page indique la dernière mise à jour, et nous donnerons un préavis raisonnable des changements importants lorsque c'est possible." },
      ],
    },
    {
      id: "contact",
      title: "30. Contact",
      blocks: [
        { p: "Questions sur cette politique, ou demandes concernant vos informations : info@ringoconnectltd.com. Ringo Connect Ltd., Yaoundé, Cameroun." },
      ],
    },
  ],
};
