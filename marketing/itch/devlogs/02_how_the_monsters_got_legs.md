# How the monsters got legs

**Type:** Tutorial / behind the scenes · **Media:** a short clip from `marketing/videos/preview_landscape_1920x1080.mp4` (convert to GIF, or upload the MP4), or `screenshot_2.png`

---

When I rebuilt FRACTURED for 3.0, I had a choice: commission sprite sheets for every enemy, or make the bodies move themselves. I went with the second.

Every walking creature in the game, your character included, is a **procedural rig**. Nothing is a pre-drawn animation. Each frame, the game works out where the body is going and the legs follow.

**Feet stay planted.** Each foot is pinned to a spot on the floor. When the body moves far enough away from it, the foot lifts, swings forward and plants again. The legs move in alternating groups, so a four-legged Predator skitters in diagonal pairs and the first boss, Sphere Head, walks on six.

**Knees solve themselves.** Given a hip and a foot, there is only one way a two-part leg can bend to reach it. The game solves that every frame (two-bone inverse kinematics, if you want the term). It's why a creature crossing uneven ground, or turning sharply, still looks like it's standing on something.

**Your character moves the same way.** The legs stride in the direction you actually move, not the way you face. The flashlight arm reaches out toward what you're aiming at, and when something gets close, you can see the fear in the pose.

**Why bother?** Three reasons:

1. **It reacts.** A lunge folds the legs back, a charge widens the stance, a hit throws the body off its feet for a moment. With fixed animations, each of those would be another drawing.
2. **It's light.** No sprite sheets to download, which matters when the game has to start fast on a phone.
3. **One art direction for everything.** Every enemy is a dark body, a pale rim and one glowing colour. Rigs let me keep that look consistent across six enemy types and five bosses.

The hardest part was teleports. Enemies that fall too far behind get moved back near you, and a foot left behind would stretch across the whole room. Now any jump re-plants every foot at once.

Next time you're cornered, watch the legs for a second. Then run.
