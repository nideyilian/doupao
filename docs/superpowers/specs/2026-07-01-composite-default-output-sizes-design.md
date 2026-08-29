# Composite Default Output Sizes

## Goal

Update the composite workspace's default output-size rules to match the four
platform groups supplied by the user.

The change applies only when creating a fresh state or resetting to defaults.
It must not merge rules into, migrate, or overwrite an existing persisted user
configuration.

## Default Rules

All rules are disabled by default and use the existing JPG format and naming
templates.

| Group | Width | Height | Maximum KB |
| --- | ---: | ---: | ---: |
| 广点通 | 1280 | 720 | 399 |
| 广点通 | 1080 | 1920 | 399 |
| 百度 | 1140 | 640 | 299 |
| 百度 | 370 | 245 | 299 |
| 百度 | 1080 | 1920 | 399 |
| 厂商 | 1280 | 720 | 99 |
| 厂商 | 1080 | 1920 | 99 |
| 厂商 | 320 | 211 | 80 |
| 厂商 | 320 | 210 | 80 |
| 厂商 | 720 | 1280 | 99 |
| 厂商 | 720 | 498 | 99 |
| 厂商 | 474 | 768 | 99 |
| 厂商 | 1080 | 528 | 99 |
| 头条 | 1080 | 1920 | 399 |
| 头条 | 1280 | 720 | 399 |

The group and rule ordering follows the supplied screenshot.

## Implementation

Change only the existing default output-rule factory and its focused tests.
Keep the current rule shape and helper function. Do not add migration logic,
new configuration layers, or UI changes.

## Verification

A focused unit test will assert:

- the four group names and their order;
- every rule's width, height, and maximum KB;
- every rule starts disabled.

Then run the focused test and the relevant composite test suite.
