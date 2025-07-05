// src/pages/Home.js
import React from 'react';
import { Link } from 'react-router-dom';
import { Card, Button } from 'react-bootstrap';
import './Home.css';

import logoRG from '../assets/logo_rg.png';
import logoWB from '../assets/logo_wb.png';
import logoUS from '../assets/logo_us.png';

export default function Home() {
  return (
    <div className="page-background home-bg">
      <div className="overlay text-center">
        <h1 className="text-white mb-3">Welcome to SMASH!</h1>
        <p className="text-white mb-5">Simulate matchups from the Grand Slam tournaments below:</p>
        <div className="d-flex justify-content-center flex-wrap">
          {[
            { to: '/french-open', logo: logoRG, title: 'French Open' },
            { to: '/wimbledon',  logo: logoWB, title: 'Wimbledon'  },
            { to: '/us-open',    logo: logoUS, title: 'US Open'    },
          ].map(({ to, logo, title }) => (
            <Card
              key={to}
              className="mb-4 mx-2 home-card"
              style={{ backgroundColor: '#222', color: '#fff' }}
            >
              <Card.Img
                variant="top"
                src={logo}
                alt={title}
                className="home-logo mx-auto mt-3"
              />
              <Card.Body className="text-center">
                <Card.Title>{title}</Card.Title>
                <Button as={Link} to={to} variant="warning">
                  Explore
                </Button>
              </Card.Body>
            </Card>
          ))}
        </div>
        <p className="text-white">
          Learn more <Link to="/about" className="text-warning">About Us</Link>
        </p>
      </div>
    </div>
  );
}
