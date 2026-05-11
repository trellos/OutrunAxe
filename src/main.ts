import Phaser from "phaser";
import { StartScene } from "./scenes/StartScene";
import { PlayScene } from "./scenes/PlayScene";
import { colors } from "./ui/style";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: colors.bg,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [StartScene, PlayScene],
});
