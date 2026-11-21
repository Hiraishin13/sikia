# Sikia — Architecture technique du MVP

Nov 21, 2026 · @Gad

## Résumé et hypothèses

Le MVP de Sikia extrait les points clés du corps **sur l'appareil de l'utilisateur**, envoie uniquement ces coordonnées (jamais la vidéo) à un serveur qui reconnaît les signes sous forme de gloses, puis un modèle de langage reformule ces gloses en phrase naturelle. Ce découpage en trois étages permet d'améliorer chaque brique séparément et protège la vie privée par défaut.

Choix structurants proposés :

- **Points clés** : MediaPipe (mains, visage, pose), exécuté dans le navigateur ou le téléphone.
- **Reconnaissance** : un modèle Transformer léger sur séquences de points clés, entraîné en PyTorch et servi en ONNX.
- **Texte naturel** : un LLM via API qui transforme une suite de gloses en phrase correcte, avec un dictionnaire de contexte.
- **Produit** : une application web progressive (PWA) d'abord, une application mobile native ensuite.

Hypothèses de travail, à confirmer (voir la dernière section) :

1. **H1** : une seule langue des signes au lancement. Par défaut je suppose la LSF (langue des signes française), puisque le projet est en français.
2. **H2** : le MVP traduit un **vocabulaire fermé de 200 à 500 signes** et des phrases courtes, pas une conversation libre.
3. **H3** : cas d'usage principal = une personne sourde signe face à la caméra de son téléphone, une personne entendante lit le texte.
4. **H4** : latence cible inférieure à 1,5 s entre la fin d'un signe et l'affichage du texte.
5. **H5** : petite équipe (1 à 3 personnes), budget d'infrastructure modeste, pas de GPU dédié en production.
6. **H6** : aucun jeu de données propriétaire existant ; on part de corpus publics plus une collecte encadrée.

## Vue d'ensemble

&#91;embedded content: architecture du MVP · téléphone, serveur, entraînement\]

Le téléphone transforme la vidéo en points clés ; le serveur en tire des gloses puis une phrase ; les corrections des utilisateurs nourrissent l'entraînement, qui publie de nouvelles versions du modèle. C'est cette boucle qui améliore la précision dans le temps.

## Capture vidéo

La vidéo reste sur l'appareil : elle est capturée à 30 images/s, analysée localement, puis jetée. Seule une collecte volontaire et consentie (voir « Vie privée ») envoie des clips au serveur.

- **API** : `getUserMedia` dans le navigateur (PWA) ; CameraX sur Android et AVFoundation sur iOS pour la version native.
- **Réglages** : caméra frontale, 640×480 ou 720p, 30 images/s. Au-delà, la précision des points clés progresse peu et le téléphone chauffe.
- **Cadrage guidé** : une silhouette à l'écran demande de garder la tête, le buste et les deux mains dans le champ. Un indicateur passe au rouge si une main sort du cadre ou si la lumière est trop faible. C'est le levier de précision le moins cher du projet.
- **Segmentation temporelle** : un détecteur d'activité sur la vitesse des mains découpe le flux en fenêtres de signes et repère les pauses entre phrases.

*Hypothèse : l'utilisateur pose le téléphone (support ou table) ; tenir le téléphone d'une main empêche de signer à deux mains.*

## Extraction des points clés

Je recommande **MediaPipe Tasks** (Google), exécuté sur l'appareil : il fournit mains, visage et pose en temps réel sur un téléphone courant, en web comme en natif, sous licence Apache 2.0.

| Composant | Points | Pourquoi on en a besoin |
| --- | --- | --- |
| Hand Landmarker | 21 par main, 3D | Configuration et orientation des doigts : l'essentiel du sens lexical |
| Pose Landmarker | 33 (on garde le haut du corps) | Position des mains par rapport au corps, mouvement des bras |
| Face Landmarker | 478 (on garde \~40 autour des yeux, sourcils, bouche) | Expressions non manuelles : question, négation, intensité |

**Normalisation avant envoi** : coordonnées recentrées sur le milieu des épaules et mises à l'échelle par leur largeur, pour que la taille de la personne et sa distance à la caméra ne changent rien. On ajoute un drapeau « main détectée » et on interpole les trous courts (moins de 5 images).

**Volume** : environ 100 points × 3 coordonnées × 30 images/s, soit environ 9 000 nombres par seconde. Quantifiés en 16 bits, cela fait moins de 20 Ko/s, ce qui passe sur une connexion 3G.

*Alternatives écartées pour le MVP* : OpenPose et MMPose sont plus précis sur certains cas, mais trop lourds pour un téléphone. Un modèle maison ne se justifiera que si MediaPipe rate trop de mains croisées ou en occlusion, ce que mesurera l'évaluation.

## Reconnaissance des signes

La reconnaissance travaille sur les séquences de points clés, pas sur les pixels : le modèle est 50 à 100 fois plus petit, s'entraîne sur un seul GPU et ignore le fond, la couleur de peau et les vêtements. On avance en deux paliers.

| Palier | Tâche | Modèle | Métrique cible |
| --- | --- | --- | --- |
| v0 (MVP) | Signes isolés : une fenêtre → un signe parmi 200 à 500 | Transformer ou Conv1D + Transformer, 2 à 8 M de paramètres | Précision top-1 ≥ 80 %, top-5 ≥ 95 % sur des signeurs jamais vus |
| v1 | Phrases continues : un flux → une suite de gloses | Même encodeur + décodage CTC | Taux d'erreur sur les gloses (WER) < 35 % |

**Données** (à vérifier une par une pour la licence et l'usage commercial) :

- Pré-entraînement sur de grands corpus publics d'une autre langue des signes, par exemple le jeu Google ISLR (ASL, environ 250 signes, déjà en points MediaPipe), WLASL ou ASL Citizen.
- Adaptation à la langue cible avec ses corpus publics ; pour la LSF, Dicta-Sign-LSF-v2 et MEDIAPI-SKEL sont les pistes à examiner.
- **Collecte Sikia** : 20 à 50 signeurs sourds, rémunérés, 10 répétitions par signe du vocabulaire MVP. C'est probablement le facteur de précision n°1.

**Augmentations** : miroir gauche/droite (signeurs gauchers), petites rotations et changements d'échelle, vitesse de 0,8× à 1,2×, suppression aléatoire de points pour simuler les occlusions.

**Évaluation** : découpage strict par signeur (aucun signeur à la fois en entraînement et en test), sinon les scores sont gonflés. Un tableau de bord suit la précision par signe pour cibler la collecte suivante.

**Pile** : PyTorch pour l'entraînement, Weights & Biases (ou MLflow) pour le suivi des expériences, export ONNX pour la production.

## Génération de texte naturel

Une langue des signes a sa propre grammaire : la suite de gloses `MOI DEMAIN MÉDECIN ALLER` doit devenir « Demain, je vais chez le médecin. ». Un LLM fait très bien ce travail de reformulation sans entraînement, à condition de le cadrer.

- **Entrée** : les gloses avec leur score de confiance (top-3 pour les signes incertains), les marqueurs non manuels détectés (question, négation) et les deux phrases précédentes pour le contexte.
- **Sortie** : une phrase en français, plus un drapeau « incertain » quand le LLM a dû choisir entre plusieurs gloses. L'app affiche alors la phrase en grisé avec une alternative.
- **Modèle** : un modèle rapide et peu coûteux via API (par exemple Claude Haiku), avec quelques exemples de traduction dans le prompt. La latence visée est de 300 à 600 ms par phrase.
- **Garde-fous** : interdiction d'ajouter une information absente des gloses ; la sortie est vérifiée par un contrôle simple (chaque glose de forte confiance doit avoir un équivalent dans la phrase).
- **Mode dégradé** : sans réseau ou si l'API ne répond pas en 2 s, l'app affiche les gloses brutes, lisibles par la plupart des entendants.

*À plus long terme* : un modèle de bout en bout (points clés → texte, sans gloses) peut dépasser cette approche, mais il exige des milliers d'heures de vidéos alignées avec du texte. Les corrections des utilisateurs collectées par le MVP constituent justement ce jeu de données.

## Backend et API

Un seul service Python, **FastAPI**, suffit au MVP : il parle la même langue que l'équipe ML, sert le modèle ONNX directement et gère les WebSockets.

| Brique | Choix | Raison |
| --- | --- | --- |
| API temps réel | FastAPI + WebSocket `/v1/stream` | Le client envoie les points clés en continu, reçoit gloses puis phrase |
| Inférence | ONNX Runtime sur CPU, dans le même processus | Un modèle de quelques millions de paramètres répond en moins de 30 ms sur CPU |
| Texte naturel | Appel API LLM depuis le serveur | La clé d'API ne quitte jamais le serveur ; cache des phrases fréquentes |
| Base de données | PostgreSQL | Comptes, sessions, retours utilisateurs, consentements |
| Stockage | Stockage objet compatible S3 | Clips de collecte consentis, jeux de données, modèles versionnés |
| Authentification | Fournisseur géré (Supabase Auth, Auth0 ou Clerk) | Évite d'écrire la gestion des mots de passe |

**Contrat du flux** : le client envoie des paquets de 10 images de points clés (environ 330 ms) ; le serveur renvoie `partial` (gloses provisoires) puis `final` (phrase) à chaque pause détectée. Un point d'accès REST `/v1/feedback` reçoit les corrections (« ce n'était pas ce signe », « la phrase correcte est… »).

*Hypothèse : le modèle tourne côté serveur au début pour pouvoir le mettre à jour sans publier l'app. Le passer sur l'appareil (ONNX Runtime Web ou mobile) est possible plus tard, pour le hors-ligne.*

## Application cliente

Je recommande de commencer par une **application web progressive (PWA)** en React + TypeScript, puis de passer au natif une fois le produit validé. MediaPipe fonctionne dans le navigateur (WebAssembly, accéléré par le GPU), une PWA s'installe sur l'écran d'accueil et se met à jour sans passer par les stores.

**Écrans du MVP** :

1. **Traduire** : l'aperçu caméra avec le guide de cadrage en haut, le texte traduit en grands caractères en bas, lisible par la personne en face. Bouton pour retourner le texte vers l'interlocuteur.
2. **Corriger** : un appui sur une phrase propose les alternatives ou un champ libre. Chaque correction alimente l'amélioration du modèle.
3. **Historique** : les dernières conversations, stockées sur l'appareil seulement par défaut.
4. **Contribuer** (optionnel) : enregistrer des signes du vocabulaire pour la collecte, avec consentement explicite.

**Accessibilité** : interface pensée d'abord pour des utilisateurs sourds, donc aucune information transmise uniquement par le son, retours visuels et vibrations, gros textes ajustables.

*Point de vigilance* : sur iOS, les PWA ont des limites (caméra en arrière-plan, performances WebGPU variables selon les versions). Si les tests sur iPhone sont décevants, on bascule vers **React Native** avec un module natif MediaPipe, en réutilisant la logique TypeScript.

## Déploiement, MLOps et observabilité

Tout tient dans un conteneur Docker déployé sur une plateforme gérée, sans GPU en production : l'inférence est légère et le LLM est appelé par API.

| Brique | Choix proposé | Alternative |
| --- | --- | --- |
| Front PWA | Hébergement statique + CDN (Cloudflare Pages, Vercel) | Netlify |
| API + inférence | Google Cloud Run ou Fly.io, région la plus proche des utilisateurs | AWS ECS Fargate, Scaleway |
| Base et auth | PostgreSQL géré (Supabase ou Neon) | Cloud SQL |
| Entraînement | GPU loué à la demande (une A100 ou L4 quelques heures par semaine) | Google Colab Pro, Kaggle pour les premiers essais |
| CI/CD | GitHub Actions : tests, build de l'image, déploiement | GitLab CI |
| Erreurs et métriques | Sentry + tableau de bord de latence et de taux de correction | Grafana Cloud |

**Cycle d'un modèle** : données versionnées (DVC ou dossiers datés sur le stockage objet), entraînement tracé, évaluation automatique sur le jeu de test par signeur, puis publication du fichier ONNX. Le serveur charge le modèle par numéro de version, ce qui permet un déploiement progressif (10 % du trafic d'abord) et un retour arrière immédiat.

**À surveiller en production** : latence de bout en bout, part des phrases marquées « incertaines », taux de correction par les utilisateurs, et signes les plus corrigés.

*Hypothèse* : les coûts d'infrastructure restent faibles au MVP (quelques dizaines d'euros par mois hors LLM et GPU d'entraînement) ; à chiffrer dès qu'on connaît le volume d'utilisateurs visé.

## Vie privée, sécurité et communauté sourde

Les données de signes sont biométriques et touchent une minorité linguistique : Sikia doit être irréprochable sur ce point dès le MVP.

- **Pas de vidéo par défaut** : seuls des points clés quittent l'appareil, et ils ne sont pas conservés après la traduction sauf consentement.
- **Consentement séparé et révocable** pour la collecte de données d'entraînement, avec suppression sur demande (RGPD : la conformité s'applique si des utilisateurs sont dans l'UE).
- **Le visage est une donnée sensible** : on ne garde que les points utiles aux expressions, jamais d'image du visage hors collecte consentie.
- **Chiffrement** : TLS partout, données chiffrées au repos, accès aux jeux de données limité à l'équipe ML.
- **Co-conception** : associer des personnes sourdes et des interprètes dès maintenant (choix du vocabulaire, tests, validation des traductions). Les projets de traduction de langues des signes conçus sans la communauté sont souvent rejetés par elle.
- **Honnêteté produit** : l'app affiche clairement qu'elle ne remplace pas un interprète, notamment en contexte médical ou juridique.

## Feuille de route vers le MVP

Quatre étapes d'environ 4 semaines chacune mènent à un pilote fermé en 4 mois environ (estimation pour 2 à 3 personnes, à recaler avec l'équipe réelle).

1. **Socle (semaines 1–4)** : PWA avec caméra et MediaPipe, enregistrement de points clés, premier modèle de signes isolés entraîné sur un corpus public. *Critère de passage* : 50 signes reconnus de bout en bout sur un téléphone milieu de gamme.
2. **Données (semaines 5–8)** : collecte avec 20 signeurs sourds sur le vocabulaire MVP, évaluation par signeur, tableau de bord de précision. *Critère* : top-1 ≥ 70 % sur signeurs jamais vus.
3. **Phrases (semaines 9–12)** : segmentation temporelle, génération de texte par LLM, écran de correction, backend complet. *Critère* : 80 % de phrases courtes jugées correctes par des interprètes.
4. **Pilote (semaines 13–16)** : 30 à 50 utilisateurs, suivi des corrections, itérations hebdomadaires du modèle. *Critère* : latence < 1,5 s et utilisateurs qui reviennent d'une semaine sur l'autre.

**Comment on mesure la précision** :

| Niveau | Métrique | Mesurée sur |
| --- | --- | --- |
| Points clés | Part des images avec les deux mains détectées | Clips de test en conditions réelles |
| Signes isolés | Précision top-1 et top-5 | Jeu de test séparé par signeur |
| Phrases | Taux d'erreur sur les gloses (WER) | Phrases annotées par des interprètes |
| Texte final | Note humaine de fidélité et de fluidité (1 à 5), complétée par BLEU ou chrF | 200 phrases de référence |
| Produit | Taux de correction par les utilisateurs | Pilote |

## Questions ouvertes

Les réponses à ces questions peuvent changer plusieurs choix ci-dessus ; les trois premières sont les plus importantes.

- [ ] **Quelle langue des signes au lancement ?** LSF, ASL, une langue africaine (le nom Sikia évoque le swahili, par exemple la langue des signes kenyane ou tanzanienne) ou une autre ? Cela détermine les corpus disponibles et la collecte.
- [ ] **Quel premier cas d'usage ?** Conversation du quotidien, accueil en guichet ou en pharmacie, éducation, santé ? Un domaine étroit permet un vocabulaire fermé et une bien meilleure précision.
- [ ] **Avez-vous déjà des données ou des partenaires** (associations de sourds, écoles, interprètes) ?
- [ ] Sur quels appareils sont vos utilisateurs (Android d'entrée de gamme, iPhone, ordinateurs) et avec quelle connexion ? Si le réseau est faible, il faut viser le hors-ligne plus tôt.
- [ ] Faut-il aussi le sens inverse (texte ou voix → signes) dans le MVP ? Je l'ai exclu.
- [ ] Composition et compétences de l'équipe (ML, mobile, web), et budget mensuel visé pour l'infrastructure et le LLM.
- [ ] Contraintes d'hébergement : les données doivent-elles rester dans un pays ou une région précise ?
