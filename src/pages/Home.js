// src/pages/Home.js

import React from 'react';
import { Link } from 'react-router-dom';
import { Card, Button } from 'react-bootstrap';
import './Home.css';

import logoRG from '../assets/logo_rg.png';
import logoWB from '../assets/logo_wb.png';
import logoUS from '../assets/logo_us.png';

export default function Home() {
  const tournaments = [
    { to: '/french-open', logo: logoRG, title: 'French Open', desc: 'Clay-court drama awaits' },
    { to: '/wimbledon',  logo: logoWB, title: 'Wimbledon',  desc: 'Tradition meets grass magic' },
    { to: '/us-open',    logo: logoUS, title: 'US Open',    desc: 'Hard-court showdowns' },
  ];

  return (
    <div className="page-background home-bg">
      <div className="overlay text-center">
        <h1 className="main-title mb-3">Welcome to SMASH!</h1>
        <p className="sub-title mb-5">
          Live the thrill of the Grand Slams <br /> Simulate your dream matchups in seconds.
        </p>
        

        <div className="d-flex justify-content-center flex-wrap">
          {tournaments.map(({ to, logo, title, desc }) => (
            <Card key={to} className="mb-4 mx-3 home-card">
              <Card.Img
                variant="top"
                src={logo}
                alt={title}
                className="home-logo mx-auto mt-4"
              />
              <Card.Body className="text-center">
                <Card.Title className="tourney-title">{title}</Card.Title>
                <Card.Text className="tourney-desc">{desc}</Card.Text>
                <Button as={Link} to={to} variant="warning" className="explore-btn">
                  Jump In
                </Button>
              </Card.Body>
            </Card>
          ))}
        </div>

        {/* <p className="footer-note">
          Ready for more? <Link to="/about" className="text-warning">Learn about SMASH</Link>
        </p> */}
      </div>
    </div>
  );
}
