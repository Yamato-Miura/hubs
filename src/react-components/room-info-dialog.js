import React, { Component } from "react";
import PropTypes from "prop-types";
import DialogContainer from "./dialog-container.js";
import styles from "../assets/stylesheets/room-info-dialog.scss";
import { scaledThumbnailUrlFor } from "../utils/media-utils";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInfoCircle } from "@fortawesome/free-solid-svg-icons/faInfoCircle";

export default class RoomInfoDialog extends Component {
  static propTypes = {
    hubName: PropTypes.string,
    scene: PropTypes.object
  };

  render() {
    const toAttributionDiv = (a, i) => {
      if (a.url) {
        const source =
          a.url.indexOf("sketchfab.com") >= 0
            ? "on Sketchfab"
            : a.url.indexOf("poly.google.com") >= 0
              ? "on Google Poly"
              : "";

        return (
          <div className={styles.attribution} key={`${a.url} ${i}`}>
            <div className={styles.attributionName}>
              <a href={a.url} target="_blank" rel="noopener noreferrer">
                {a.name}
              </a>
            </div>
            <div className={styles.attributionAuthor}>
              by {a.author} {source}
            </div>
          </div>
        );
      } else {
        return (
          <div className={styles.attribution} key={`${a.name} ${a.author} {i}`}>
            <div className={styles.attributionName}>{a.name}</div>
            <div className={styles.attributionAuthor}>by {a.author}</div>
          </div>
        );
      }
    };

    let attributions = null;
    let creator = null;

    // TODO remove
    this.props.scene.attributions = {
      content: [
        {
          url: "https://sketchfab.com/models/128d863ab5c8467f80939cabe8b3fc34",
          name: "Model Demo 1",
          author: "A Cool Guy"
        },
        {
          url: "https://sketchfab.com/models/128d863ab5c8467f80939cabe8b3fc33",
          name: "Another super super super super long model name here",
          author: "Another author"
        },
        {
          url: "https://sketchfab.com/models/128d863ab5c8467f80939cabe8b3fc34",
          name: "Model Demo 1",
          author: "A Cool Guy"
        },
        {
          url: "https://sketchfab.com/models/128d863ab5c8467f80939cabe8b3fc33",
          name: "Another long model name here",
          author: "Another author"
        },
        {
          url: "https://sketchfab.com/models/128d863ab5c8467f80939cabe8b3fc34",
          name: "Model Demo 1",
          author: "A Cool Guy"
        },
        {
          url: "https://sketchfab.com/models/128d863ab5c8467f80939cabe8b3fc33",
          name: "Another long model name here",
          author: "Another author"
        }
      ],
      creator: "Creator Dude Here Really long name it keeps going what what"
    };

    if (this.props.scene.attributions) {
      creator = this.props.scene.attributions.creator;
      attributions = (
        <div>
          {this.props.scene.attributions.content && this.props.scene.attributions.content.map(toAttributionDiv)}
        </div>
      );
    }

    const title = <div className={styles.title}>{this.props.hubName}</div>;

    return (
      <DialogContainer title={title} wide={true} {...this.props}>
        <div className={styles.roomInfo}>
          <div className={styles.sceneScreenshot}>
            <a href={this.props.scene.url} target="_blank" rel="noopener noreferrer">
              <img src={scaledThumbnailUrlFor(this.props.scene.screenshot_url, 400, 480)} />
            </a>
          </div>
          <div className={styles.sceneDetails}>
            <div className={styles.sceneMain}>
              <div className={styles.sceneName}>
                <a href={this.props.scene.url} target="_blank" rel="noopener noreferrer">
                  {this.props.scene.name}
                </a>
              </div>
              <div className={styles.sceneCreator}>{creator}</div>
            </div>
            <div className={styles.sceneAttributions}>{attributions}</div>
            <div className={styles.sceneButtons}> </div>
          </div>
        </div>
      </DialogContainer>
    );
  }
}
