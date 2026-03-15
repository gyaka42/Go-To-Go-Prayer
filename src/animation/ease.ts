import type { AnimateProps, Transition } from "react-native-ease";

export const easeInitialLift: AnimateProps = {
  opacity: 0,
  translateY: 10
};

export const easeVisibleLift: AnimateProps = {
  opacity: 1,
  translateY: 0
};

export const easeInitialFade: AnimateProps = {
  opacity: 0
};

export const easeVisibleFade: AnimateProps = {
  opacity: 1
};

export const easeEnterTransition: Transition = {
  type: "timing",
  duration: 260,
  easing: [0.2, 0.8, 0.2, 1]
};

export const easeStateTransition: Transition = {
  type: "timing",
  duration: 180,
  easing: "easeOut"
};

export const easeFastTransition: Transition = {
  type: "timing",
  duration: 140,
  easing: "easeOut"
};

export const easeSlowTransition: Transition = {
  type: "timing",
  duration: 360,
  easing: [0.2, 0.8, 0.2, 1]
};

export const easeStaggerTransition: Transition = {
  type: "timing",
  duration: 220,
  easing: [0.24, 0.82, 0.25, 1]
};

export const easePressTransition: Transition = {
  type: "spring",
  damping: 18,
  stiffness: 260,
  mass: 1
};

export const easeButtonStateTransition: Transition = {
  type: "spring",
  damping: 20,
  stiffness: 300,
  mass: 1
};
