# Race Time — écarts restants entre Android et le web

Comparaison de l’APK Android **1.0.6** avec la branche web **`dev` au commit `839c2e2`**, réalisée le 26 novembre 2026. Les écarts confirmés reposent sur les ressources de l’APK, le code Java décompilé et le code web. La décompilation est partielle et aucun appareil Android n’était connecté. Les mesures de conduite, de rendu et de son figurent donc dans la liste des vérifications en jeu.

Les cases constituent le backlog. **P1** désigne les écarts qui changent le parcours ou les règles, **P2** les écarts de présentation et de confort, et **Décision** les fonctionnalités dont l’équivalent web reste à choisir.

## 1. Tournois, classements et multijoueur

- [ ] **P1 · Calendrier et résultats partagés.** Android lit une configuration de tournoi avec identifiant, circuit, début et fin. Le web fait tourner les 21 Sprint à minuit selon l’heure du navigateur. Fournir un calendrier commun et rattacher les résultats à un tournoi stable, y compris si une course commence avant sa clôture.
- [ ] **P1 · Classement de joueurs.** Android propose des vues mondiale et amis. Le web affiche le joueur local, des pilotes IA et le fantôme de référence. Ajouter des résultats de vrais joueurs, leurs rangs et une vue amis quand les profils existent.
- [ ] **P1 · Fantômes adverses.** Le duel web fonctionne avec des replays de référence, des IA et un fantôme personnel en Course libre. Permettre de récupérer et d’affronter le replay associé au chrono d’un autre joueur. Vérifier qu’il se rejoue avec la même version de physique et le bon circuit. Le code Android observé correspond à des duels asynchrones, sans établir l’existence de courses temps réel.
- [ ] **P1 · Profils et amis.** Ajouter un nom de joueur durable, la recherche ou l’ajout d’amis et la synchronisation des résultats entre appareils. Android prévoit la saisie d’un nom, l’invitation d’amis et des connexions de plateforme. Le web conserve les données dans le navigateur.
- [ ] **P1 · Clôture du tournoi.** Android dispose d’un écran de résultats de tournoi et d’une logique de rang et de récompense selon le classement. Le web affiche le dernier résultat local. Prévoir un résultat final consultable après clôture, la division, le rang final et, si retenues, les récompenses.
- [ ] **P1 · Seuils de divisions.** Android utilise jusqu’à trois chronos en millisecondes issus du tableau `tm` de l’événement. Le web utilise le fantôme de référence pour Pro, une cible 5 % plus rapide pour Master et classe les autres arrivées en Novice. Récupérer des seuils historiques si un cache ou une réponse d’époque est disponible. Sinon, calibrer et valider de nouveaux seuils par tracé. Les valeurs officielles n’ont pas été trouvées dans les ressources de piste.
- [ ] **P2 · Détails du verrou Pro.** Le web déverrouille le Pro du jour au seuil Sprint et conserve un mécanisme séparé en Course libre. Android lit le résultat du Sprint actif et impose, dans certains chemins, des contrôles supplémentaires liés à l’événement. Vérifier les cas de changement de jour, d’égalité au seuil et de retour d’une course lancée avant la fin du tournoi.

Sources Android : [accueil et classements](race-time-1-0-6/sources/com/peoplefun/racetime/vc.java), [configuration de tournoi](race-time-1-0-6/sources/com/peoplefun/racetime/bp.java), [qualification et divisions](race-time-1-0-6/sources/com/peoplefun/racetime/qh.java), [résultats](race-time-1-0-6/sources/com/peoplefun/racetime/ajm.java). Côté web : [accueil et sauvegardes](web/home.js), [duel et rendu](web/game.js).

## 2. Garage, cadeaux et progression

- [ ] **P1 · Garage par collections.** Les 65 véhicules importés sont tous sélectionnables sur le web. Android dispose de 13 entrées dans `carsets.json`, d’états verrouillé et acquis et d’un véhicule qui se débloque après les cinq premiers de sa collection. Afficher les collections, leur progression et les conditions d’accès.
- [ ] **P1 · Inventaire des véhicules.** L’import exclut 29 entrées nommées des données Android, dont des véhicules de type visuel 3 et des modèles dont l’image n’est pas résolue. Établir les modèles réellement proposés dans le garage Android avant de porter les manquants. Les entrées de données anciennes, variantes et objets techniques peuvent être exclus après vérification. Vérifier en priorité X-Former, Qube, UFO et Drone.
- [ ] **P1 · Utilisation des pièces.** Le cadeau web ajoute 50 pièces au solde local, sans usage dans le garage. Android dispose d’un parcours d’achat et d’une roue de récompenses. Définir les coûts et les règles de tirage, puis faire débiter et créditer les pièces dans la même opération que l’acquisition.
- [ ] **P2 · Présentation du garage.** Ajouter un aperçu du véhicule, les états « nouveau », « à collecter » et verrouillé, ainsi que les animations utiles lors d’une acquisition. Le garage web est actuellement une grille de sélection en Course libre. Décider si le tournoi doit aussi donner un accès direct au garage.
- [ ] **P2 · Cadeau et collecte.** Android possède une séquence d’ouverture, de révélation et de collecte. Le web affiche directement le nouveau solde. Reproduire la séquence utile, vérifier la cadence et les montants d’origine, et confirmer qu’un cadeau ne peut être crédité qu’une fois.
- [ ] **P2 · Succès.** Porter les objectifs que l’on peut confirmer dans Android, enregistrer leur progression et afficher un retour au déblocage. Préférer des succès intégrés au jeu pour une version web indépendante des services de plateforme.
- [ ] **Décision · Offres et boutique.** Android prévoit des vidéos pour doubler un cadeau ou obtenir des pièces ou un véhicule, ainsi que des achats et leur restauration. Décider si ces parcours doivent être remplacés par des récompenses de jeu, intégrés à une boutique web ou laissés hors périmètre.

Sources Android : [garage et roue](race-time-1-0-6/sources/com/peoplefun/racetime/qo.java), [cadeau](race-time-1-0-6/sources/com/peoplefun/racetime/qu.java), [succès](race-time-1-0-6/sources/com/peoplefun/racetime/bv.java), [produits](race-time-1-0-6/sources/com/peoplefun/racetime/qm.java). Côté web : [garage et cadeaux](web/home.js), [filtres d’import](web/import-assets.mjs).

## 3. Accueil, départ et arrivée

- [x] **P2 · Première participation.** L’accueil explique le contrôle à une touche et le classement avant le premier chrono. Un message confirme la première arrivée du tournoi affiché.
- [x] **P2 · Repères de temps sur la route.** Des repères intermédiaires complètent les divisions et restent en dehors des points de sélection des pilotes.
- [ ] **P2 · Fidélité de la route du classement.** Comparer l’échelle des écarts entre pilotes, la position des repères et l’inertie tactile avec l’APK sur téléphone. La distance web reste approximative, avec un plafond pour les gros écarts.
- [x] **P2 · Intro de duel.** Les panneaux annoncent le circuit et présentent les deux véhicules, le nom de l’adversaire et son chrono cible.
- [x] **P2 · Signal du deuxième tour.** Le message animé « Dernier tour ! » accompagne le signal sonore et disparaît automatiquement.
- [x] **P2 · Verdict de duel.** Le résultat présente le rang des deux pilotes, l’écart en secondes ou l’égalité et un effet visuel de victoire.
- [ ] **P2 · Fidélité des animations de course.** Comparer sur téléphone la synchronisation des panneaux, de la voix et des feux, puis vérifier le maintien de la caméra et le timing des cartes après la ligne.
- [x] **P2 · Accueil après un résultat.** Après un premier chrono ou un nouveau record du jour, la route se recentre sur la voiture du joueur à sa nouvelle position.
- [x] **P2 · Remontée au classement.** La file reste au milieu et le joueur emprunte une voie latérale avant de se réinsérer. Tous les dépassements sont montrés, y compris ceux de pilotes hors top 100, affichés le temps de l’animation. La durée s’adapte au nombre de places gagnées. En mouvement réduit, le recentrage est immédiat.
- [x] **P2 · Top 100 et position hors classement affiché.** La route affiche les 100 premiers. Le joueur hors top 100 reste visible à la fin avec son rang réel. Un plateau de 120 adversaires simulés par tracé permet de tester ce cas avant l’arrivée des classements partagés.
- [x] **P2 · Podium sur la route.** Les trois premiers véhicules portent une médaille or, argent ou bronze. Deux fantômes d’allure peuplent la division Master et peuvent être affrontés.

Sources Android : [accueil](race-time-1-0-6/sources/com/peoplefun/racetime/vc.java), [route](race-time-1-0-6/sources/com/peoplefun/racetime/uh.java), [intro de duel](race-time-1-0-6/sources/com/peoplefun/racetime/ajv.java), [course et arrivée](race-time-1-0-6/sources/com/peoplefun/racetime/aar.java), [tutoriel](race-time-1-0-6/sources/com/peoplefun/racetime/aaq.java). Côté web : [écrans](web/index.html), [rendu de course](web/game.js).

## 4. Audio et réglages

- [ ] **P2 · Clics et déblocages.** Ajouter les clics d’interface aux actions pertinentes. L’APK contient aussi un son de déblocage Pro, dont le déclenchement exact reste à confirmer. Les sons de changement Sprint/Pro et la voix du duel sont déjà présents.
- [ ] **P2 · Cadeau, pièces et garage.** Raccorder les deux sons d’ouverture de cadeau, le tintement de pièces et les sons de roue ou d’acquisition aux animations correspondantes, en respectant la coupure globale.
- [ ] **P2 · Réglage du moteur et des niveaux.** Le son moteur web est revenu au comportement précédent de `dev` lors du dernier commit audio. L’inconfort signalé à accélération maintenue reste ouvert. Comparer plusieurs moteurs Android et web à l’écoute, préserver leur montée d’origine et vérifier le passage au maintien. Comparer aussi les frottements, l’ambiance de piste et les niveaux de victoire et de défaite.
- [ ] **P2 · Démarrage de la musique.** La boucle d’accueil existe. Certains navigateurs la bloquent avant la première interaction. Vérifier la reprise après un geste, après une course et après réactivation du son. Si nécessaire, ajouter un contrôle explicite pour démarrer la musique.
- [ ] **Décision · Réglages et notifications.** Android affiche des paramètres plus complets, dont les notifications et des liens vers les succès de plateforme. Le web propose principalement une coupure globale. Décider quels contrôles exposer, notamment des réglages séparés pour musique et effets et des rappels de tournoi facultatifs.

Sources Android : [sons et transition](race-time-1-0-6/sources/com/peoplefun/racetime/ajv.java), [sons en course](race-time-1-0-6/sources/com/peoplefun/racetime/aag.java), [réglages](race-time-1-0-6/sources/com/peoplefun/racetime/abv.java). Côté web : [lecture et mixage](web/game.js).

## 5. Vérifications de fidélité en jeu

- [ ] **P1 · Physique et chronométrage.** Comparer sur les mêmes véhicules et circuits l’accélération, la roue libre, le changement de voie, les contacts muraux, la ligne qui valide un tour et le chrono final. Le moteur web tourne déjà à 100 Hz. Tester au minimum un Sprint, son Pro et un circuit avec des virages serrés.
- [ ] **P1 · Cadence et interruption.** Vérifier la stabilité du chrono et des commandes à différentes cadences d’affichage et lors d’un passage en arrière-plan, d’une perte de focus ou d’une rotation de l’écran. Le web libère les commandes sur perte de focus.
- [ ] **P2 · Caméra et piste.** Comparer sur téléphone le cadrage, l’échelle, les lignes de départ et le rendu des décors autour des virages. Tester notamment les objets au premier plan et les bords de piste.
- [ ] **P2 · Véhicules et effets.** Comparer l’échelle relative et le rendu des modèles atypiques, des ombres, des rubans, des particules de propulsion et des effets de dérapage et de collision. Le web prend déjà en charge une partie de ces effets, sans mesure de fidélité pour tous les modèles.
- [ ] **P2 · Parcours tactile.** Tester le défilement avec centrage sur un pilote, le geste de départ, le maintien de l’accélérateur et la fin de course sur un téléphone. Vérifier aussi le mouvement réduit et la navigation clavier, qui sont des adaptations web.

Côté web : [physique](web/physics.js), [effets de véhicules](web/vehicle-effects.js), [rendu et commandes](web/game.js). Les ressources Android associées se trouvent dans `race-time-1-0-6/resources/assets/monkey`.

## Différences assumées à ce stade

- **Course libre** reste un mode web secondaire pour choisir un circuit, jouer contre un fantôme personnel ou de référence et consulter ses chronos locaux. Les résultats de tournoi et de Course libre restent séparés.
- Le clavier, la souris et le réglage de mouvement réduit sont des compléments web. Ils ne constituent pas des écarts à supprimer.
- Les intégrations de plateforme, la publicité et les achats sont des décisions de produit. Leur présence dans l’APK ne vaut pas décision de les réintroduire.
