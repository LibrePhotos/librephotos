import React from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: JSX.Element;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Use Everywhere',
    description: (
      <>
        Access your photo library from anywhere, using any device or operating system.
      </>
    ),
  },
  {
    title: 'Support for all the files types',
    description: (
      <>
        LibrePhotos supports all major file formats, including RAW images, HEIC / HEIF and videos
      </>
    ),
  },
  {
    title: 'Powered by AI and Open Source',
    description: (
      <>
        Get the same power as those commercial services without giving up your personal data and privacy.
      </>
    ),
  },
];

function Feature({title, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        
      </div>
      <div className="text--center padding-horiz--md">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): JSX.Element {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
